import type { ResolveAttempt } from '@jir/shared';
import { logger } from '../core/logger.js';
import { runAttempt } from './orchestrator.service.js';

// Per-Space worker chain. Serial within a Space (no concurrent worktree /
// git plumbing races), parallel across Spaces (different clones, different
// agent processes, no shared state on disk).
//
// Slice 8's loop scheduler will reuse this primitive — interval-based ticks
// will call scheduleAttempt the same way "Tick now" does. A global cap
// across Spaces will be added there (pLimit at the runAttempt boundary).
const spaceWorkers = new Map<string, Promise<void>>();

// Schedules a runAttempt to execute in the background. Returns immediately
// (fire-and-forget). The HTTP handler creates QUEUED attempts and calls
// this; the UI sees them progress by polling the attempts table.
export function scheduleAttempt(attempt: ResolveAttempt): void {
  const prev = spaceWorkers.get(attempt.spaceId) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined) // don't propagate prior errors to the next attempt
    .then(async () => {
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
    })
    .finally(() => {
      // Drop the entry if we're the tail of the chain, so the Map doesn't
      // grow unboundedly across the Space's lifetime.
      if (spaceWorkers.get(attempt.spaceId) === next) {
        spaceWorkers.delete(attempt.spaceId);
      }
    });
  spaceWorkers.set(attempt.spaceId, next);
}
