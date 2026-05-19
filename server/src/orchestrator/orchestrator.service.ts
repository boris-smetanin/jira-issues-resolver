import type { AttemptStatus, ResolveAttempt } from '@jir/shared';
import { logger } from '../core/logger.js';
import { worktreeRemove } from '../integrations/git/git.client.js';
import { getComments, getIssue } from '../integrations/jira/jira.client.js';
import { runAgent } from '../integrations/sandcastle/sandcastle.runner.js';
import { transitionStatus } from '../resolve-attempts/resolve-attempts.repository.js';
import { getSettings } from '../settings/settings.repository.js';
import { findInternalActiveById } from '../spaces/spaces.repository.js';
import { prepareWorktree } from './branch.resolver.js';
import { finalize } from './commit.finalizer.js';
import { buildPrompt } from './prompt.formatter.js';

// Walks an attempt through the state machine:
//   QUEUED → PREPARING_REPO → AGENT_RUNNING → CHECKING_COMMITS →
//     FINISHED | FINISHED_NO_CHANGES | FAILED
//
// Slice 5b stops just before the push/PR/transition sequence (those land in
// slice 6). FINISHED here is the *local* finished state: a squashed commit
// exists on the issue branch in the worktree's parent clone.
export async function runAttempt(attempt: ResolveAttempt): Promise<void> {
  let stuckAt: AttemptStatus = 'QUEUED';
  let cloneDir: string | null = null;
  let worktreePath: string | null = null;

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

    await runAgent({
      space,
      attemptId: attempt.id,
      worktreePath,
      prompt,
    });

    // ─── CHECKING_COMMITS ────────────────────────────────────────────
    stuckAt = 'CHECKING_COMMITS';
    await transitionStatus(attempt.id, 'CHECKING_COMMITS');

    const { commits } = await finalize({
      worktreePath,
      baseRef: prepared.baseRef,
      issueKey: attempt.issueKey,
      attemptId: attempt.id,
      priorAttemptId: attempt.priorAttemptId,
    });

    if (commits === 0) {
      await transitionStatus(attempt.id, 'FINISHED_NO_CHANGES', {
        endedAt: new Date(),
      });
      return;
    }

    // ─── FINISHED ────────────────────────────────────────────────────
    // Slice 6 inserts PUSHING / OPENING_PR / TRANSITIONING_JIRA between
    // CHECKING_COMMITS and FINISHED. For slice 5 we stop here.
    await transitionStatus(attempt.id, 'FINISHED', { endedAt: new Date() });
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
    if (cloneDir && worktreePath) {
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
