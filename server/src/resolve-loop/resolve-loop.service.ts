import type { ResolveAttempt, Space } from '@jir/shared';
import { logger } from '../core/logger.js';
import { searchJql } from '../integrations/jira/jira.client.js';
import { scheduleAttempt } from '../orchestrator/scheduler.js';
import {
  createNextAttempt,
  findInFlightForIssue,
} from '../resolve-attempts/resolve-attempts.service.js';
import { getSettings } from '../settings/settings.repository.js';
import { buildJql } from '../spaces/jql.builder.js';
import {
  findAllRunning,
  setLastTickAt,
  setLoopRunning,
  setTickInterval,
} from '../spaces/spaces.repository.js';
import { findSpaceById } from '../spaces/spaces.service.js';
import { createWorker, type Worker } from './worker.js';

export class TickError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TickError';
    this.status = status;
  }
}

export type TickResult = {
  created: ResolveAttempt[];
  skipped: Array<{ issueKey: string; reason: string }>;
};

// Single tick: query Jira for matching issues, create a QUEUED attempt per
// new one, hand them to the scheduler. Used by both the worker loop and
// the manual "Tick now" button. Stamps last_tick_at unconditionally so the
// grid card reflects "when did this Space last try" regardless of caller.
export async function tickOnce(spaceId: string): Promise<TickResult> {
  const space = await findSpaceById(spaceId);
  if (!space) throw new TickError('Space not found', 404);
  if (!space.agentAccountId) {
    throw new TickError(
      'Space has no agent account assigned. Assign one in the Space detail page first.',
      400,
    );
  }

  const settings = await getSettings();
  if (!settings.jiraEmail || !settings.jiraApiToken || !settings.jiraBaseUrl) {
    throw new TickError('Jira global settings are not configured. Open Settings first.', 400);
  }
  const creds = {
    baseUrl: settings.jiraBaseUrl,
    email: settings.jiraEmail,
    token: settings.jiraApiToken,
  };

  const jql = buildJql({
    jiraProject: space.jiraProject,
    filterField: space.filterField,
    filterValue: space.filterValue,
    allowedStatuses: space.allowedStatuses,
    agentLabels: space.agentLabels,
  });

  await setLastTickAt(space.id, new Date());

  const result = await searchJql(creds, { jql, maxResults: 50 });

  const created: ResolveAttempt[] = [];
  const skipped: Array<{ issueKey: string; reason: string }> = [];

  for (const issue of result.issues) {
    const issueKey = issue.key;
    const inFlight = await findInFlightForIssue(space.id, issueKey);
    if (inFlight) {
      skipped.push({
        issueKey,
        reason: `in-flight attempt ${inFlight.id} (${inFlight.status})`,
      });
      continue;
    }
    const attempt = await createNextAttempt({ spaceId: space.id, issueKey });
    scheduleAttempt(attempt);
    created.push(attempt);
  }

  return { created, skipped };
}

// ───────────────────────── loop / worker management ─────────────────────────

const workers = new Map<string, Worker>();

function buildWorker(space: Space): Worker {
  return createWorker({
    spaceId: space.id,
    initialIntervalSeconds: space.tickIntervalSeconds,
    tickFn: async () => {
      try {
        const result = await tickOnce(space.id);
        if (result.created.length > 0 || result.skipped.length > 0) {
          logger.info('loop tick produced attempts', {
            spaceId: space.id,
            created: result.created.length,
            skipped: result.skipped.length,
          });
        }
      } catch (err) {
        // Surface and continue — the worker logs and keeps looping.
        logger.warn('loop tick failed', {
          spaceId: space.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}

export async function startLoop(spaceId: string): Promise<Space> {
  const space = await findSpaceById(spaceId);
  if (!space) throw new TickError('Space not found', 404);
  if (!space.agentAccountId) {
    throw new TickError(
      'Space has no agent account assigned. Assign one in the Space detail page first.',
      400,
    );
  }
  if (workers.has(spaceId)) {
    // Idempotent: caller may flip the same Space on twice.
    return space;
  }
  const w = buildWorker(space);
  workers.set(spaceId, w);
  const updated = await setLoopRunning(spaceId, true);
  w.start();
  logger.info('loop started', { spaceId, intervalSeconds: space.tickIntervalSeconds });
  return updated ?? space;
}

export async function stopLoop(spaceId: string): Promise<Space> {
  const space = await findSpaceById(spaceId);
  if (!space) throw new TickError('Space not found', 404);
  const w = workers.get(spaceId);
  if (w) {
    workers.delete(spaceId);
    await w.stop();
  }
  const updated = await setLoopRunning(spaceId, false);
  logger.info('loop stopped', { spaceId });
  return updated ?? space;
}

// "Tick now" delegates to the worker (which aborts its sleep) if the loop
// is running, otherwise runs an ad-hoc tick. Worker path returns
// immediately because the tick happens on the worker's own promise chain;
// the UI polls the attempts table to pick up the results.
export async function tickNow(spaceId: string): Promise<{
  mode: 'worker' | 'ad-hoc';
  result?: TickResult;
}> {
  const w = workers.get(spaceId);
  if (w) {
    w.tickNow();
    return { mode: 'worker' };
  }
  const result = await tickOnce(spaceId);
  return { mode: 'ad-hoc', result };
}

export async function setLoopInterval(spaceId: string, seconds: number): Promise<Space> {
  const updated = await setTickInterval(spaceId, seconds);
  if (!updated) throw new TickError('Space not found', 404);
  const w = workers.get(spaceId);
  if (w) w.setIntervalSeconds(seconds);
  return updated;
}

// Called from index.ts after orphan reconciliation. Reads every Space with
// loop_running = true and restarts its worker.
export async function resumeRunningLoops(): Promise<number> {
  const running = await findAllRunning();
  for (const space of running) {
    if (!space.agentAccountId) {
      // Don't auto-resume a Space whose account was unassigned. Flip the
      // flag back to false so the UI shows the correct state.
      await setLoopRunning(space.id, false);
      logger.warn('skipping loop resume — no agent account', { spaceId: space.id });
      continue;
    }
    const w = buildWorker(space);
    workers.set(space.id, w);
    w.start();
    logger.info('loop resumed', {
      spaceId: space.id,
      intervalSeconds: space.tickIntervalSeconds,
    });
  }
  return running.length;
}

// Called from SIGTERM/SIGINT. Stops every worker (which aborts its sleep)
// and awaits each loop to finish its in-flight tick (if any). The 10s
// force-exit timer in index.ts is the safety net.
export async function stopAllLoops(): Promise<void> {
  const all = Array.from(workers.entries());
  workers.clear();
  await Promise.allSettled(all.map(([, w]) => w.stop()));
}

export function activeWorkerCount(): number {
  return workers.size;
}
