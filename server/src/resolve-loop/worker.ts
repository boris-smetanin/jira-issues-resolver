import { logger } from '../core/logger.js';

// Per-Space loop worker. Owns nothing about Jira / git / orchestration —
// just the sleep-and-tick machinery, parametrised by a `tickFn` callback
// that does the actual work. The service layer constructs one Worker per
// Space and supplies a tickFn that calls `tickOnce(spaceId)`.
//
// Lifecycle:
//   start() → fire-and-forget loop. Returns immediately.
//   stop()  → set running=false + abort the current sleep. Awaits the
//             in-flight tick (if any) to finish. The 10s force-exit timer
//             in index.ts is the safety net for a stuck tick.
//   tickNow() → abort the current sleep so the next iteration starts
//             immediately. No-op if a tick is already running.

export type Worker = {
  start: () => void;
  stop: () => Promise<void>;
  tickNow: () => void;
  setIntervalSeconds: (seconds: number) => void;
};

export type CreateWorkerArgs = {
  spaceId: string;
  initialIntervalSeconds: number;
  tickFn: () => Promise<void>;
};

export function createWorker(args: CreateWorkerArgs): Worker {
  let running = false;
  let intervalMs = args.initialIntervalSeconds * 1000;
  let sleepAbort: AbortController | null = null;
  let loopPromise: Promise<void> | null = null;

  async function loop(): Promise<void> {
    while (running) {
      try {
        await args.tickFn();
      } catch (err) {
        // A tick should never throw — tickOnce catches its own errors and
        // surfaces them as `skipped` entries. But if anything escapes,
        // log it and keep looping; we don't want one bad tick to kill the
        // worker.
        logger.error('worker tick threw', {
          spaceId: args.spaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (!running) return;
      await abortableSleep(intervalMs);
    }
  }

  function abortableSleep(ms: number): Promise<void> {
    const ac = new AbortController();
    sleepAbort = ac;
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        sleepAbort = null;
        resolve();
      }, ms);
      ac.signal.addEventListener('abort', () => {
        clearTimeout(t);
        sleepAbort = null;
        resolve();
      });
    });
  }

  return {
    start: () => {
      if (running) return;
      running = true;
      loopPromise = loop();
    },
    stop: async () => {
      running = false;
      sleepAbort?.abort();
      if (loopPromise) {
        await loopPromise.catch(() => undefined);
      }
    },
    tickNow: () => {
      // Aborts the current sleep so the loop fires a tick immediately.
      // No-op if we're already mid-tick — it'll just sleep less next time.
      sleepAbort?.abort();
    },
    setIntervalSeconds: (seconds) => {
      intervalMs = seconds * 1000;
    },
  };
}
