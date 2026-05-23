import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../core/logger.js';
import { getSettings } from '../settings/settings.repository.js';

// Slice 14: hourly sweeper for per-attempt NDJSON log files. Lifted-and-
// adapted from the auto-bug-fixer reference's `startLogCleanupTimer`.
//
// Cadence: 1 hour (matches PRD Q9). Settings are re-read each tick so
// a UI change to `log_retention_days` takes effect on the next sweep
// without a restart.
//
// Targets only the orchestrator's NDJSON files (`<dataDir>/logs/*.ndjson`).
// Anything else under that directory is ignored — keeps the sweeper safe
// if a future slice writes a sibling .json index or .gz archive.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CleanupResult = {
  scanned: number;
  removed: string[];
};

/**
 * One-shot sweep. Exported for tests and for the boot-time first run.
 * Uses each file's `mtime` as the age clock — orchestrator appends to
 * the file as the attempt runs, so the mtime is "last write", which is
 * the right thing for retention. Files with no extension and non-.ndjson
 * files are skipped (defence-in-depth, not a real expected case).
 */
export async function cleanupOldLogs(
  logsDir: string,
  retentionDays: number,
): Promise<CleanupResult> {
  const cutoff = Date.now() - retentionDays * MS_PER_DAY;
  const removed: string[] = [];

  const entries = await readLogsDir(logsDir);
  if (entries === undefined) return { scanned: 0, removed };

  for (const name of entries) {
    if (!name.endsWith('.ndjson')) continue;
    const filePath = join(logsDir, name);
    const stat = await fsp.stat(filePath).catch(() => undefined);
    if (!stat || !stat.isFile()) continue;
    if (stat.mtimeMs >= cutoff) continue;
    const unlinked = await fsp.unlink(filePath).then(
      () => true,
      () => false,
    );
    if (unlinked) removed.push(name);
  }

  return { scanned: entries.length, removed };
}

// `readdir` on a missing directory throws ENOENT — for a brand-new
// install the logs/ dir is created lazily on the first attempt, so we
// soft-no-op instead of crashing the timer.
async function readLogsDir(logsDir: string): Promise<string[] | undefined> {
  try {
    return await fsp.readdir(logsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

let timer: NodeJS.Timeout | undefined;
let inFlight: Promise<void> | undefined;

/**
 * Start the hourly sweeper. Runs once immediately (awaited so boot-time
 * cleanup is observable in the startup log), then schedules itself on a
 * setInterval. Idempotent — calling twice is a noop.
 */
export async function startLogCleanupTimer(logsDir: string): Promise<void> {
  if (timer) return;
  await runSweep(logsDir);
  timer = setInterval(() => {
    void runSweep(logsDir);
  }, SWEEP_INTERVAL_MS);
  timer.unref();
}

/**
 * Stop the sweeper. Clears the interval and awaits any in-flight sweep
 * so the shutdown handler doesn't race the unlink loop.
 */
export async function stopLogCleanupTimer(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  if (inFlight) {
    await inFlight.catch(() => undefined);
    inFlight = undefined;
  }
}

async function runSweep(logsDir: string): Promise<void> {
  if (inFlight) return;
  inFlight = (async () => {
    try {
      const { days } = await readRetention();
      const { scanned, removed } = await cleanupOldLogs(logsDir, days);
      logger.info('log retention sweep', {
        retentionDays: days,
        scanned,
        removed: removed.length,
      });
    } catch (err) {
      logger.error('log retention sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  try {
    await inFlight;
  } finally {
    inFlight = undefined;
  }
}

async function readRetention(): Promise<{ days: number }> {
  const s = await getSettings();
  return { days: s.logRetentionDays };
}
