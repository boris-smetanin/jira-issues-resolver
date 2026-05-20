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
  parseGitHubRepoUrl,
} from '../integrations/github/github.client.js';
import {
  getComments,
  getIssue,
  listTransitions,
  transitionIssue,
} from '../integrations/jira/jira.client.js';
import { runAgent } from '../integrations/sandcastle/sandcastle.runner.js';
import { createAttemptLog, type AttemptLogger } from '../logs/attempt-log.js';
import { transitionStatus } from '../resolve-attempts/resolve-attempts.repository.js';
import { getSettings } from '../settings/settings.repository.js';
import { findInternalActiveById } from '../spaces/spaces.repository.js';
import { prepareWorktree } from './branch.resolver.js';
import { finalize } from './commit.finalizer.js';
import {
  formatPullRequestBody,
  formatPullRequestTitle,
} from './pr-body.formatter.js';
import { buildPrompt } from './prompt.formatter.js';

function logFilePathFor(attemptId: string): string {
  return join(appConfig.dataDir, 'logs', `${attemptId}.ndjson`);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
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
  } else if (event.type === 'toolCall') {
    log.log(
      'info',
      'sandcastle',
      `tool: ${event.name}(${truncate(event.formattedArgs, 300)})`,
      { eventType: 'toolCall', tool: event.name, iteration: event.iteration },
    );
  }
}

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
    stuckAt = 'PREPARING_REPO';
    log.log('info', 'orchestrator', 'state → PREPARING_REPO');
    await transitionStatus(attempt.id, 'PREPARING_REPO', { logFilePath });

    const settings = await getSettings();
    if (!settings.jiraEmail || !settings.jiraApiToken || !settings.jiraBaseUrl) {
      throw new Error('Jira global settings are missing');
    }
    const jiraCreds = {
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

    const prompt = buildPrompt({ issue, comments });

    // ─── AGENT_RUNNING ───────────────────────────────────────────────
    stuckAt = 'AGENT_RUNNING';
    log.log('info', 'orchestrator', 'state → AGENT_RUNNING');
    await transitionStatus(attempt.id, 'AGENT_RUNNING');

    await runAgent({
      space,
      attemptId: attempt.id,
      worktreePath,
      prompt,
      onEvent: (event) => sandcastleEventToLog(log, event),
    });
    log.log('info', 'sandcastle', 'agent run complete');

    // ─── CHECKING_COMMITS ────────────────────────────────────────────
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
      log.log('info', 'orchestrator', 'agent made no commits → FINISHED_NO_CHANGES');
      await transitionStatus(attempt.id, 'FINISHED_NO_CHANGES', { endedAt: new Date() });
      success = true;
      return;
    }
    log.log('info', 'git', 'commits squashed into one', {
      subject: finalized.agentMessage.subject,
    });

    // ─── PUSHING ─────────────────────────────────────────────────────
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
    stuckAt = 'OPENING_PR';
    log.log('info', 'orchestrator', 'state → OPENING_PR');
    await transitionStatus(attempt.id, 'OPENING_PR');
    const { owner, repo } = parseGitHubRepoUrl(space.githubRepoUrl);
    let pr = await findPRByBranch({
      owner,
      repo,
      branch: attempt.issueKey,
      token: space.githubToken,
    });
    if (!pr) {
      log.log('info', 'github', 'no existing PR; creating');
      try {
        pr = await createPR({
          owner,
          repo,
          token: space.githubToken,
          title: formatPullRequestTitle(issue),
          body: formatPullRequestBody({
            issue,
            attempt,
            jiraBaseUrl: jiraCreds.baseUrl,
            agentMessage: finalized.agentMessage,
          }),
          head: attempt.issueKey,
          base: space.baseBranch,
        });
      } catch (err) {
        // GitHub returns 422 "A pull request already exists" if a PR is
        // created between our find and our create. Race-resolve.
        if (err instanceof GitHubAccessError && err.status === 422) {
          log.log('warn', 'github', '422 from createPR; refetching');
          pr = await findPRByBranch({
            owner,
            repo,
            branch: attempt.issueKey,
            token: space.githubToken,
          });
          if (!pr) throw err;
        } else {
          throw err;
        }
      }
    } else {
      log.log('info', 'github', `existing PR found: ${pr.html_url}`);
    }
    log.log('info', 'github', `PR ready: ${pr.html_url}`, { prNumber: pr.number });

    // ─── TRANSITIONING_JIRA (soft-fail) ──────────────────────────────
    stuckAt = 'TRANSITIONING_JIRA';
    log.log('info', 'orchestrator', 'state → TRANSITIONING_JIRA');
    await transitionStatus(attempt.id, 'TRANSITIONING_JIRA');
    let transitionWarning: string | undefined;
    try {
      const transitions = await listTransitions(jiraCreds, attempt.issueKey);
      const match = transitions.find((t) => t.to.name === space.targetStatusName);
      if (!match) {
        transitionWarning = `No transition to "${space.targetStatusName}" available from the issue's current status`;
        log.log('warn', 'jira', transitionWarning);
      } else {
        try {
          await transitionIssue(jiraCreds, attempt.issueKey, match.id);
          log.log('info', 'jira', `transitioned to "${space.targetStatusName}"`);
        } catch (err) {
          transitionWarning = err instanceof Error ? err.message : String(err);
          log.log('warn', 'jira', `transition call failed: ${transitionWarning}`);
        }
      }
    } catch (err) {
      transitionWarning = err instanceof Error ? err.message : String(err);
      log.log('warn', 'jira', `listTransitions failed: ${transitionWarning}`);
    }

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
    const errorReason = err instanceof Error ? err.message : String(err);
    log.log('error', 'orchestrator', `runAttempt failed at ${stuckAt}: ${errorReason}`);
    logger.error('runAttempt failed', {
      attemptId: attempt.id,
      stuckAt,
      error: errorReason,
    });
    await transitionStatus(attempt.id, 'FAILED', {
      errorReason,
      stuckAtStatus: stuckAt,
      endedAt: new Date(),
    });
  } finally {
    if (success && cloneDir && worktreePath) {
      try {
        await worktreeRemove(cloneDir, worktreePath);
        log.log('info', 'git', 'worktree removed');
      } catch (cleanupErr) {
        const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        log.log('warn', 'git', `worktree cleanup failed: ${msg}`);
        logger.warn('worktree cleanup failed', {
          attemptId: attempt.id,
          worktreePath,
          error: msg,
        });
      }
    }
    log.close();
  }
}
