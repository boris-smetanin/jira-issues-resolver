import { join } from 'node:path';
import type { AgentStreamEvent } from '@ai-hero/sandcastle';
import type { AttemptStatus, ResolveAttempt } from '@jir/shared';
import { config as appConfig } from '../core/config.js';
import { logger } from '../core/logger.js';
import { push, worktreeRemove } from '../integrations/git/git.client.js';
import {
  GitHubAccessError,
  createPR,
  findPRByBranch,
  listAllPRComments,
  parseGitHubRepoUrl,
  type PRComment,
  type PullRequest,
} from '../integrations/github/github.client.js';
import {
  getComments,
  getIssue,
  listTransitions,
  transitionIssue,
  type JiraComment,
  type JiraCreds,
  type JiraIssue,
} from '../integrations/jira/jira.client.js';
import { findInternalAccountById } from '../agent-accounts/agent-accounts.service.js';
import { adfToMarkdown } from '../integrations/adf/adf.formatter.js';
import { runAgent } from '../integrations/sandcastle/sandcastle.runner.js';
import { createAttemptLog, type AttemptLogger } from '../logs/attempt-log.js';
import {
  findById as findAttemptById,
  setDepsInstalled,
  setPromptRendered,
  setPromptShape,
  transitionStatus,
} from '../resolve-attempts/resolve-attempts.repository.js';
import { register as registerStop, unregister as unregisterStop } from '../resolve-attempts/stop.registry.js';
import { getSettings } from '../settings/settings.repository.js';
import {
  findInternalActiveById,
  type InternalSpace,
} from '../spaces/spaces.repository.js';
import { prepareWorktree } from './branch.resolver.js';
import { finalize } from './commit.finalizer.js';
import {
  formatPullRequestBody,
  formatPullRequestTitle,
} from './pr-body.formatter.js';
import { HITL_MARKER } from './comments.js';
import { detectInstallCommand, runInstall } from './dep-installer.js';
import { checkForEscalation, handleEscalation } from './escalation-handler.js';
import { shapeFor } from './issue-type-map.js';
import { buildPrompt, type PriorAttemptContext } from './prompt.formatter.js';

function logFilePathFor(attemptId: string): string {
  return join(appConfig.dataDir, 'logs', `${attemptId}.ndjson`);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Forward Sandcastle's stream events to the attempt log. Each text chunk
// becomes one line; each tool call becomes one line. Truncated so a giant
// agent dump doesn't blow up the NDJSON file.
function sandcastleEventToLog(log: AttemptLogger, event: AgentStreamEvent): void {
  if (event.type === 'text') {
    log.log('info', 'sandcastle', `agent: ${truncate(event.message.trim(), 1000)}`, {
      eventType: 'text',
      iteration: event.iteration,
    });
    return;
  }
  if (event.type === 'toolCall') {
    log.log(
      'info',
      'sandcastle',
      `tool: ${event.name}(${truncate(event.formattedArgs, 300)})`,
      { eventType: 'toolCall', tool: event.name, iteration: event.iteration },
    );
  }
}

// ───────────────────────────── helpers ──────────────────────────────────
//
// Each helper handles a single sub-step of the state machine with early
// returns at the top instead of nested `if` pyramids inside runAttempt.
// runAttempt itself stays a thin narrative of the state transitions.

// Slice 9: fetch a prior PR's review/conversation comments. Returns [] for
// any reason that means "no PR comments to inject" (prior never opened a
// PR, GitHub flaked). Caller treats this purely as "context I'd like if
// available."
async function fetchPriorPRComments(args: {
  priorAttempt: ResolveAttempt;
  space: InternalSpace;
  log: AttemptLogger;
}): Promise<PRComment[]> {
  const { priorAttempt, space, log } = args;
  if (!priorAttempt.prUrl || priorAttempt.prNumber === null) return [];

  const { owner, repo } = parseGitHubRepoUrl(space.githubRepoUrl);
  try {
    return await listAllPRComments({
      owner,
      repo,
      prNumber: priorAttempt.prNumber,
      token: space.githubToken,
    });
  } catch (err) {
    // Soft-fail: a flaky GitHub API shouldn't fail the attempt — we'd
    // rather lose reopen context than lose the run.
    log.log('warn', 'github', `fetching prior PR comments failed: ${errMsg(err)}`);
    return [];
  }
}

// Issue #37: walk back through `prior_attempt_id` (max 5 hops) until we
// find a prior with a non-null `prUrl`. Without this, an intermediate
// FAILED / FINISHED_NO_CHANGES / ESCALATED row in the chain (any
// attempt that never opened a PR) makes the orchestrator return zero
// PR-comment context — even when an EARLIER attempt did open a PR
// reviewers commented on. Mirrors the failure mode that bit us during
// slice 16b smoke testing.
//
// Cap at 5 hops to prevent runaway on malformed chains. In practice
// real chains are shallow (1-3 attempts per issue).
const MAX_CHAIN_WALK_HOPS = 5;

async function findPRBearingPrior(args: {
  startId: string;
  log: AttemptLogger;
}): Promise<ResolveAttempt | null> {
  const { startId, log } = args;
  let cursorId: string | null = startId;
  let hops = 0;
  while (cursorId !== null && hops < MAX_CHAIN_WALK_HOPS) {
    const row: ResolveAttempt | null = await findAttemptById(cursorId);
    if (!row) {
      log.log(
        'warn',
        'orchestrator',
        `chain walk: prior ${cursorId} not found; stopping`,
      );
      return null;
    }
    if (row.prUrl && row.prNumber !== null) return row;
    cursorId = row.priorAttemptId;
    hops++;
  }
  if (hops >= MAX_CHAIN_WALK_HOPS) {
    log.log(
      'warn',
      'orchestrator',
      `chain walk: hit ${MAX_CHAIN_WALK_HOPS}-hop cap without finding a PR-bearing prior`,
    );
  }
  return null;
}

// Slice 9 + Issue #37: assemble the reopen context block fed into
// buildPrompt. Two improvements over the original slice-9 implementation:
//
// 1. Chain walk — instead of looking at exactly `priorAttemptId`, walk
//    back through priors until we find one with a PR. The immediate
//    prior is still the source of `endedAt` (for the Jira
//    comments-since cutoff), since "since when did this issue become
//    eligible again" is what that timestamp represents.
//
// 2. HITL dedupe — comments with `+hitl-to-agent+` are pulled into the
//    HITL block (top of the prompt, section 4) by the comment splitter.
//    They should NOT also appear in the reopen block's Jira-comments-
//    since section. Filter them out here.
async function fetchReopenContext(args: {
  attempt: ResolveAttempt;
  space: InternalSpace;
  comments: JiraComment[];
  log: AttemptLogger;
}): Promise<PriorAttemptContext | undefined> {
  const { attempt, space, comments, log } = args;
  if (!attempt.priorAttemptId) return undefined;

  const immediatePrior = await findAttemptById(attempt.priorAttemptId);
  if (!immediatePrior) {
    log.log(
      'warn',
      'orchestrator',
      `attempt.priorAttemptId=${attempt.priorAttemptId} not found; skipping reopen context`,
    );
    return undefined;
  }

  // The Jira-comments-since cutoff is anchored to the IMMEDIATE prior's
  // endedAt — that's "since when did the human take action again."
  // The PR-bearing prior may be further back; its endedAt would be
  // older and miss intermediate Jira comments.
  const endedAt = immediatePrior.endedAt;

  // Walk back to find the most-recent PR-bearing prior. If the
  // immediate prior already has a PR, this returns the immediate prior
  // (one hop) — no perf regression for the common case.
  const prBearing = await findPRBearingPrior({ startId: immediatePrior.id, log });

  const prComments = prBearing
    ? await fetchPriorPRComments({ priorAttempt: prBearing, space, log })
    : [];

  // Issue #37 fix #2: filter HITL out of jiraCommentsSince so they
  // don't appear twice (once in the HITL block at the top + once in
  // the reopen-context block).
  const jiraCommentsSince = endedAt
    ? comments
        .filter((c) => c.createdAt > endedAt)
        .filter((c) => {
          const body = adfToMarkdown(c.bodyAdf) || '';
          return !body.toLowerCase().includes(HITL_MARKER);
        })
    : [];

  log.log(
    'info',
    'orchestrator',
    `reopen context: immediatePrior=${immediatePrior.id} prBearing=${prBearing?.id ?? 'none'} prComments=${prComments.length} jiraSince=${jiraCommentsSince.length}`,
    {
      immediatePriorPrUrl: immediatePrior.prUrl,
      prBearingPrUrl: prBearing?.prUrl ?? null,
      priorEndedAt: endedAt,
    },
  );

  return {
    endedAt,
    prUrl: prBearing?.prUrl ?? null,
    prComments,
    jiraCommentsSince,
  };
}

// Slice 6: find-or-create the PR for this attempt. Handles the 422 race
// (PR created between our find and our create) by refetching and
// returning the existing one.
async function ensurePullRequest(args: {
  attempt: ResolveAttempt;
  space: InternalSpace;
  issue: JiraIssue;
  jiraBaseUrl: string;
  agentMessage: { subject: string; body: string };
  log: AttemptLogger;
}): Promise<PullRequest> {
  const { attempt, space, issue, jiraBaseUrl, agentMessage, log } = args;
  const { owner, repo } = parseGitHubRepoUrl(space.githubRepoUrl);

  const existing = await findPRByBranch({
    owner,
    repo,
    branch: attempt.issueKey,
    token: space.githubToken,
  });
  if (existing) {
    log.log('info', 'github', `existing PR found: ${existing.html_url}`);
    return existing;
  }

  log.log('info', 'github', 'no existing PR; creating');
  try {
    return await createPR({
      owner,
      repo,
      token: space.githubToken,
      title: formatPullRequestTitle(issue),
      body: formatPullRequestBody({ issue, attempt, jiraBaseUrl, agentMessage }),
      head: attempt.issueKey,
      base: space.baseBranch,
    });
  } catch (err) {
    // GitHub returns 422 "A pull request already exists" when another
    // process opened the PR between our find and our create. Refetch.
    if (!(err instanceof GitHubAccessError) || err.status !== 422) throw err;
    log.log('warn', 'github', '422 from createPR; refetching');
    const raced = await findPRByBranch({
      owner,
      repo,
      branch: attempt.issueKey,
      token: space.githubToken,
    });
    if (!raced) throw err;
    return raced;
  }
}

// Slice 6: try to move the Jira issue to the target status. Soft-fail —
// returns a warning string instead of throwing. The orchestrator stores
// the warning on the attempt row but still marks FINISHED, because the PR
// is open and the agent's job is done.
async function attemptJiraTransition(args: {
  issueKey: string;
  targetStatusName: string;
  jiraCreds: JiraCreds;
  log: AttemptLogger;
}): Promise<string | undefined> {
  const { issueKey, targetStatusName, jiraCreds, log } = args;

  let transitions;
  try {
    transitions = await listTransitions(jiraCreds, issueKey);
  } catch (err) {
    const msg = errMsg(err);
    log.log('warn', 'jira', `listTransitions failed: ${msg}`);
    return msg;
  }

  const match = transitions.find((t) => t.to.name === targetStatusName);
  if (!match) {
    const warning = `No transition to "${targetStatusName}" available from the issue's current status`;
    log.log('warn', 'jira', warning);
    return warning;
  }

  try {
    await transitionIssue(jiraCreds, issueKey, match.id);
    log.log('info', 'jira', `transitioned to "${targetStatusName}"`);
    return undefined;
  } catch (err) {
    const msg = errMsg(err);
    log.log('warn', 'jira', `transition call failed: ${msg}`);
    return msg;
  }
}

// Slice 6 invariant: worktree is preserved on FAILED so the user can
// inspect what the agent left behind. Only remove it after a clean
// terminal state.
async function cleanupWorktree(args: {
  cloneDir: string;
  worktreePath: string;
  attemptId: string;
  log: AttemptLogger;
}): Promise<void> {
  const { cloneDir, worktreePath, attemptId, log } = args;
  try {
    await worktreeRemove(cloneDir, worktreePath);
    log.log('info', 'git', 'worktree removed');
  } catch (err) {
    const msg = errMsg(err);
    log.log('warn', 'git', `worktree cleanup failed: ${msg}`);
    logger.warn('worktree cleanup failed', {
      attemptId,
      worktreePath,
      error: msg,
    });
  }
}

// Slice 15: thrown by `throwIfAborted` at every state-transition
// checkpoint to short-circuit the state machine into the FAILED branch
// with `error_reason = 'stopped by user'`. Caught by name (not by
// signal-aborted state) so an aborted Sandcastle / git op that bubbles
// up some other AbortError still gets the same treatment.
export class StopRequestedError extends Error {
  constructor() {
    super('stopped by user');
    this.name = 'StopRequestedError';
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new StopRequestedError();
}

// ───────────────────────────── runAttempt ───────────────────────────────

// Walks an attempt through the state machine. Slice 7 adds per-attempt
// NDJSON logging — every transition + every external-call outcome + every
// Sandcastle stream event lands in `data/logs/<attemptId>.ndjson`.
export async function runAttempt(attempt: ResolveAttempt): Promise<void> {
  let stuckAt: AttemptStatus = 'QUEUED';
  let cloneDir: string | null = null;
  let worktreePath: string | null = null;
  let success = false;

  const logFilePath = logFilePathFor(attempt.id);
  const log = createAttemptLog({
    spaceId: attempt.spaceId,
    attemptId: attempt.id,
    logFilePath,
  });

  // Slice 15: register the abort controller so POST /resolve-attempts/
  // :id/stop can fire .abort() on it. Checkpoints below throw
  // StopRequestedError if signal.aborted, which the catch block
  // converts to FAILED + error_reason='stopped by user'. Unregistered
  // in the finally so the registry doesn't leak entries after terminal.
  const abortSignal = registerStop(attempt.id);

  try {
    log.log('info', 'orchestrator', `runAttempt start for ${attempt.issueKey}`, {
      attemptNumber: attempt.attemptNumber,
      priorAttemptId: attempt.priorAttemptId,
    });

    const space = await findInternalActiveById(attempt.spaceId);
    if (!space) {
      log.log('error', 'orchestrator', 'Space not found');
      await transitionStatus(attempt.id, 'FAILED', {
        errorReason: 'Space not found',
        stuckAtStatus: 'QUEUED',
        logFilePath,
        endedAt: new Date(),
      });
      return;
    }

    // ─── PREPARING_REPO ──────────────────────────────────────────────
    throwIfAborted(abortSignal);
    stuckAt = 'PREPARING_REPO';
    log.log('info', 'orchestrator', 'state → PREPARING_REPO');
    await transitionStatus(attempt.id, 'PREPARING_REPO', { logFilePath });

    const settings = await getSettings();
    if (!settings.jiraEmail || !settings.jiraApiToken || !settings.jiraBaseUrl) {
      throw new Error('Jira global settings are missing');
    }
    const jiraCreds: JiraCreds = {
      baseUrl: settings.jiraBaseUrl,
      email: settings.jiraEmail,
      token: settings.jiraApiToken,
    };

    log.log('info', 'jira', `fetching ${attempt.issueKey}`);
    const [issue, comments] = await Promise.all([
      getIssue(jiraCreds, attempt.issueKey),
      getComments(jiraCreds, attempt.issueKey),
    ]);
    log.log('info', 'jira', `fetched issue + ${comments.length} comment(s)`, {
      summary: issue.summary,
      status: issue.status,
    });

    log.log('info', 'git', 'preparing worktree');
    const prepared = await prepareWorktree({ space, issueKey: attempt.issueKey });
    cloneDir = prepared.cloneDir;
    worktreePath = prepared.worktreePath;
    log.log('info', 'git', `worktree ready at ${prepared.worktreePath}`, {
      baseRef: prepared.baseRef,
    });

    const prior = await fetchReopenContext({ attempt, space, comments, log });

    // Slice 16a/b: resolve the prompt shape. JQL should already exclude
    // unrecognised types; null is defensive — feature-shape is used as
    // the fallback inside buildPrompt.
    const shape = shapeFor(issue.issuetype, settings.issueTypeMap);
    if (shape === null && issue.issuetype) {
      log.log(
        'warn',
        'orchestrator',
        `issuetype "${issue.issuetype}" did not match any configured shape; falling back to feature-shape`,
      );
    } else if (shape) {
      log.log('info', 'orchestrator', `resolved prompt shape: ${shape}`, {
        issuetype: issue.issuetype,
      });
    }
    await setPromptShape(attempt.id, shape);

    // ─── DEP INSTALL (code-improvement-shape only) ───────────────────
    // Static checkers (tsc, mypy, phpstan, etc.) need installed deps to
    // be useful. Bug/feature attempts skip this — read-based
    // verification is the discipline for those.
    let depsInstalledHint: 'installed' | 'failed' | 'not-attempted' = 'not-attempted';
    if (shape === 'code-improvement') {
      const cmd = detectInstallCommand(worktreePath);
      if (!cmd) {
        log.log('info', 'install', 'no recognised lockfile in worktree — skipping install');
      } else {
        // Build env overrides from the Space's optional npmrc config.
        const envOverrides: Record<string, string> = {};
        if (space.npmrcEnvName && space.npmrcEnvValue) {
          envOverrides[space.npmrcEnvName] = space.npmrcEnvValue;
          log.log('info', 'install', `injecting npmrc env var ${space.npmrcEnvName}`);
        }
        const result = await runInstall({ worktreePath, command: cmd, envOverrides, log });
        if (result.kind === 'installed') {
          depsInstalledHint = 'installed';
          await setDepsInstalled(attempt.id, true);
        } else if (result.kind === 'failed') {
          // Soft-fallback: agent falls back to read-based verification.
          // The prompt's depsInstalledHint='failed' tells it to do so
          // explicitly.
          depsInstalledHint = 'failed';
        }
      }
    }

    const prompt = buildPrompt({ issue, comments, prior, shape, depsInstalledHint });
    await setPromptRendered(attempt.id, prompt);

    // ─── AGENT_RUNNING ───────────────────────────────────────────────
    throwIfAborted(abortSignal);
    stuckAt = 'AGENT_RUNNING';
    log.log('info', 'orchestrator', 'state → AGENT_RUNNING');
    await transitionStatus(attempt.id, 'AGENT_RUNNING');

    // Slice 12 AC #2: log the resolved provider so the attempt log proves
    // which factory (claudeCode / codex) was dispatched. Cheap: account is
    // already in the DB cache from earlier validations.
    if (space.agentAccountId) {
      const account = await findInternalAccountById(space.agentAccountId);
      if (account) {
        log.log('info', 'sandcastle', `dispatching ${account.provider}(${space.agentModel})`, {
          provider: account.provider,
          model: space.agentModel,
        });
      }
    }

    await runAgent({
      space,
      attemptId: attempt.id,
      worktreePath,
      prompt,
      onEvent: (event) => sandcastleEventToLog(log, event),
      signal: abortSignal,
    });
    log.log('info', 'sandcastle', 'agent run complete');

    // ─── CHECKING_COMMITS ────────────────────────────────────────────
    throwIfAborted(abortSignal);
    stuckAt = 'CHECKING_COMMITS';
    log.log('info', 'orchestrator', 'state → CHECKING_COMMITS');
    await transitionStatus(attempt.id, 'CHECKING_COMMITS');
    const finalized = await finalize({
      worktreePath,
      baseRef: prepared.baseRef,
      issueKey: attempt.issueKey,
      attemptId: attempt.id,
      priorAttemptId: attempt.priorAttemptId,
    });

    if (finalized.commits === 0) {
      // Slice 16b: before declaring FINISHED_NO_CHANGES, check whether
      // the agent escalated by writing `.jir/escalation.md`. If so, run
      // the escalation flow (Jira comment + label + ESCALATED status)
      // instead of the no-changes terminal.
      const escalationCheck = await checkForEscalation(worktreePath);
      if (escalationCheck.kind === 'escalated') {
        await handleEscalation({
          attempt,
          issueKey: attempt.issueKey,
          content: escalationCheck.content,
          jiraCreds,
          log,
        });
        success = true;
        return;
      }
      log.log('info', 'orchestrator', 'agent made no commits → FINISHED_NO_CHANGES');
      await transitionStatus(attempt.id, 'FINISHED_NO_CHANGES', { endedAt: new Date() });
      success = true;
      return;
    }
    log.log('info', 'git', 'commits squashed into one', {
      subject: finalized.agentMessage.subject,
    });

    // ─── PUSHING ─────────────────────────────────────────────────────
    throwIfAborted(abortSignal);
    stuckAt = 'PUSHING';
    log.log('info', 'orchestrator', 'state → PUSHING');
    await transitionStatus(attempt.id, 'PUSHING');
    await push({
      wtPath: worktreePath,
      branch: attempt.issueKey,
      token: space.githubToken,
      forceWithLease: true,
    });
    log.log('info', 'git', `pushed origin/${attempt.issueKey} (--force-with-lease)`);

    // ─── OPENING_PR ──────────────────────────────────────────────────
    throwIfAborted(abortSignal);
    stuckAt = 'OPENING_PR';
    log.log('info', 'orchestrator', 'state → OPENING_PR');
    await transitionStatus(attempt.id, 'OPENING_PR');
    const pr = await ensurePullRequest({
      attempt,
      space,
      issue,
      jiraBaseUrl: jiraCreds.baseUrl,
      agentMessage: finalized.agentMessage,
      log,
    });
    log.log('info', 'github', `PR ready: ${pr.html_url}`, { prNumber: pr.number });

    // ─── TRANSITIONING_JIRA (soft-fail) ──────────────────────────────
    throwIfAborted(abortSignal);
    stuckAt = 'TRANSITIONING_JIRA';
    log.log('info', 'orchestrator', 'state → TRANSITIONING_JIRA');
    await transitionStatus(attempt.id, 'TRANSITIONING_JIRA');
    const transitionWarning = await attemptJiraTransition({
      issueKey: attempt.issueKey,
      targetStatusName: space.targetStatusName,
      jiraCreds,
      log,
    });

    // ─── FINISHED ────────────────────────────────────────────────────
    log.log('info', 'orchestrator', 'state → FINISHED');
    await transitionStatus(attempt.id, 'FINISHED', {
      prUrl: pr.html_url,
      prNumber: pr.number,
      ...(transitionWarning ? { transitionWarning } : {}),
      endedAt: new Date(),
    });
    success = true;
  } catch (err) {
    const stoppedByUser = err instanceof StopRequestedError;
    const errorReason = stoppedByUser ? 'stopped by user' : errMsg(err);
    log.log('error', 'orchestrator', `runAttempt failed at ${stuckAt}: ${errorReason}`);
    logger.error('runAttempt failed', {
      attemptId: attempt.id,
      stuckAt,
      error: errorReason,
      stoppedByUser,
    });
    await transitionStatus(attempt.id, 'FAILED', {
      errorReason,
      stuckAtStatus: stuckAt,
      endedAt: new Date(),
    });
    // Slice 15: stop-by-user counts as a clean teardown for cleanup
    // purposes — the user explicitly asked us to stop, so leaving a
    // stale worktree around for debugging is noise, not signal.
    if (stoppedByUser && cloneDir && worktreePath) {
      await cleanupWorktree({ cloneDir, worktreePath, attemptId: attempt.id, log });
    }
  } finally {
    if (success && cloneDir && worktreePath) {
      await cleanupWorktree({ cloneDir, worktreePath, attemptId: attempt.id, log });
    }
    unregisterStop(attempt.id);
    log.close();
  }
}
