import type { ResolveAttempt } from '@jir/shared';
import { withGate } from '../core/concurrency.js';
import { logger } from '../core/logger.js';
import { runAttempt } from './orchestrator.service.js';

// Per-Space worker chain. Serial within a Space (no concurrent worktree /
// git plumbing races), parallel across Spaces — bounded by the process-wide
// concurrency gate (see core/concurrency.ts). Each runAttempt acquires a
// global slot inside the chain, so the cap is applied AFTER the per-Space
// serialization: a Space with 10 queued attempts still runs them one at a
// time, but only N attempts globally are inside runAttempt at once.
const spaceWorkers = new Map<string, Promise<void>>();

// Schedules a runAttempt to execute in the background. Returns immediately
// (fire-and-forget). The HTTP handler / loop worker creates QUEUED attempts
// and calls this; the UI sees them progress by polling the attempts table
// and via the live-logs SSE stream.
export function scheduleAttempt(attempt: ResolveAttempt): Promise<void> {
  const prev = spaceWorkers.get(attempt.spaceId) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined) // don't propagate prior errors to the next attempt
    .then(() =>
      withGate(async () => {
        try {
          await runAttempt(attempt);
        } catch (err) {
          // runAttempt has its own try/catch that marks FAILED; if anything
          // escapes, log it so we don't lose it.
          logger.error('scheduled attempt threw', {
            attemptId: attempt.id,
            spaceId: attempt.spaceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    )
    .finally(() => {
      // Drop the entry if we're the tail of the chain, so the Map doesn't
      // grow unboundedly across the Space's lifetime.
      if (spaceWorkers.get(attempt.spaceId) === next) {
        spaceWorkers.delete(attempt.spaceId);
      }
    });
  spaceWorkers.set(attempt.spaceId, next);
  return next;
}

// Slice 8 graceful shutdown: wait until every scheduled attempt has either
// finished or its runAttempt has returned. Doesn't cancel in-flight work —
// the index.ts shutdown path applies a 10s force-exit timer on top.
export async function awaitAllSchedules(): Promise<void> {
  while (spaceWorkers.size > 0) {
    const snapshot = Array.from(spaceWorkers.values());
    await Promise.allSettled(snapshot);
  }
}
