import type { AttemptStatus, ResolveAttempt } from '@jir/shared';
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

// Walks an attempt through the state machine:
//   QUEUED → PREPARING_REPO → AGENT_RUNNING → CHECKING_COMMITS →
//     PUSHING → OPENING_PR → TRANSITIONING_JIRA →
//       FINISHED | FINISHED_NO_CHANGES | FAILED
//
// Slice 6 adds PUSHING / OPENING_PR / TRANSITIONING_JIRA. The Jira transition
// is soft-fail (sets transition_warning, still FINISHED). The push step is
// hard-fail (FAILED with stuck_at_status=PUSHING, worktree preserved for
// debugging). Worktree is removed only on success.
export async function runAttempt(attempt: ResolveAttempt): Promise<void> {
  let stuckAt: AttemptStatus = 'QUEUED';
  let cloneDir: string | null = null;
  let worktreePath: string | null = null;
  let success = false;

  const space = await findInternalActiveById(attempt.spaceId);
  if (!space) {
    await transitionStatus(attempt.id, 'FAILED', {
      errorReason: 'Space not found',
      stuckAtStatus: 'QUEUED',
      endedAt: new Date(),
    });
    return;
  }

  try {
    // ─── PREPARING_REPO ──────────────────────────────────────────────
    stuckAt = 'PREPARING_REPO';
    await transitionStatus(attempt.id, 'PREPARING_REPO');

    const settings = await getSettings();
    if (!settings.jiraEmail || !settings.jiraApiToken || !settings.jiraBaseUrl) {
      throw new Error('Jira global settings are missing');
    }
    const jiraCreds = {
      baseUrl: settings.jiraBaseUrl,
      email: settings.jiraEmail,
      token: settings.jiraApiToken,
    };

    const [issue, comments] = await Promise.all([
      getIssue(jiraCreds, attempt.issueKey),
      getComments(jiraCreds, attempt.issueKey),
    ]);

    const prepared = await prepareWorktree({ space, issueKey: attempt.issueKey });
    cloneDir = prepared.cloneDir;
    worktreePath = prepared.worktreePath;

    const prompt = buildPrompt({ issue, comments });

    // ─── AGENT_RUNNING ───────────────────────────────────────────────
    stuckAt = 'AGENT_RUNNING';
    await transitionStatus(attempt.id, 'AGENT_RUNNING');
    await runAgent({ space, attemptId: attempt.id, worktreePath, prompt });

    // ─── CHECKING_COMMITS ────────────────────────────────────────────
    stuckAt = 'CHECKING_COMMITS';
    await transitionStatus(attempt.id, 'CHECKING_COMMITS');
    const finalized = await finalize({
      worktreePath,
      baseRef: prepared.baseRef,
      issueKey: attempt.issueKey,
      attemptId: attempt.id,
      priorAttemptId: attempt.priorAttemptId,
    });

    if (finalized.commits === 0) {
      await transitionStatus(attempt.id, 'FINISHED_NO_CHANGES', {
        endedAt: new Date(),
      });
      success = true;
      return;
    }

    // ─── PUSHING ─────────────────────────────────────────────────────
    stuckAt = 'PUSHING';
    await transitionStatus(attempt.id, 'PUSHING');
    await push({
      wtPath: worktreePath,
      branch: attempt.issueKey,
      token: space.githubToken,
      forceWithLease: true,
    });

    // ─── OPENING_PR ──────────────────────────────────────────────────
    stuckAt = 'OPENING_PR';
    await transitionStatus(attempt.id, 'OPENING_PR');
    const { owner, repo } = parseGitHubRepoUrl(space.githubRepoUrl);
    let pr = await findPRByBranch({
      owner,
      repo,
      branch: attempt.issueKey,
      token: space.githubToken,
    });
    if (!pr) {
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
        // created between our find and our create. Race-resolve by finding
        // it again.
        if (err instanceof GitHubAccessError && err.status === 422) {
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
    }

    // ─── TRANSITIONING_JIRA (soft-fail) ──────────────────────────────
    stuckAt = 'TRANSITIONING_JIRA';
    await transitionStatus(attempt.id, 'TRANSITIONING_JIRA');
    let transitionWarning: string | undefined;
    try {
      const transitions = await listTransitions(jiraCreds, attempt.issueKey);
      const match = transitions.find((t) => t.to.name === space.targetStatusName);
      if (!match) {
        transitionWarning = `No transition to "${space.targetStatusName}" available from the issue's current status`;
      } else {
        try {
          await transitionIssue(jiraCreds, attempt.issueKey, match.id);
        } catch (err) {
          transitionWarning = err instanceof Error ? err.message : String(err);
        }
      }
    } catch (err) {
      // listTransitions itself failed — soft-fail. PR is open; surfacing
      // this as FAILED would be more annoying than helpful.
      transitionWarning = err instanceof Error ? err.message : String(err);
    }

    // ─── FINISHED ────────────────────────────────────────────────────
    await transitionStatus(attempt.id, 'FINISHED', {
      prUrl: pr.html_url,
      prNumber: pr.number,
      ...(transitionWarning ? { transitionWarning } : {}),
      endedAt: new Date(),
    });
    success = true;
  } catch (err) {
    const errorReason = err instanceof Error ? err.message : String(err);
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
    // Slice 6 cleanup rule: remove worktree only on success. Failed
    // worktrees are preserved on disk for debugging; the next tick's
    // prepareWorktree force-removes them before reusing the path.
    if (success && cloneDir && worktreePath) {
      try {
        await worktreeRemove(cloneDir, worktreePath);
      } catch (cleanupErr) {
        logger.warn('worktree cleanup failed', {
          attemptId: attempt.id,
          worktreePath,
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        });
      }
    }
  }
}
