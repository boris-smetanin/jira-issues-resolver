import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './core/config.js';
import { initConcurrencyGate } from './core/concurrency.js';
import { closeDb } from './core/db.js';
import { logger } from './core/logger.js';
import { applyMigrations } from './migrations/runner.js';
import { awaitAllSchedules } from './orchestrator/scheduler.js';
import { markOrphanedAttempts } from './resolve-attempts/resolve-attempts.service.js';
import {
  resumeRunningLoops,
  stopAllLoops,
} from './resolve-loop/resolve-loop.service.js';
import { getSettings } from './settings/settings.repository.js';

const SHUTDOWN_FORCE_EXIT_MS = 10_000;

async function main(): Promise<void> {
  await applyMigrations();

  // Load global cap into the concurrency gate. Slice 8 stores it in
  // `settings.global_concurrency_cap`; later slices can expose a settings
  // UI for it.
  const settings = await getSettings();
  initConcurrencyGate(settings.globalConcurrencyCap);
  logger.info('concurrency gate initialised', { cap: settings.globalConcurrencyCap });

  // Orphan reconciliation MUST run before we restart any worker — otherwise
  // a freshly-resumed loop could write a new attempt while old non-terminal
  // rows are still claiming the (space, issue) lock via findInFlight.
  const orphans = await markOrphanedAttempts('orphaned at boot');
  if (orphans.length > 0) {
    logger.warn('marked orphaned attempts as FAILED', { count: orphans.length });
  }

  const resumed = await resumeRunningLoops();
  if (resumed > 0) {
    logger.info('resumed loops', { count: resumed });
  }

  const app = createApp();
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(`server listening on http://localhost:${info.port}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);

    // Force-exit if shutdown takes too long. Matches the auto-bug-fixer
    // pattern: a stuck agent can pin the in-flight tick, so we cap the
    // wait at 10s and bail.
    const forceTimer = setTimeout(() => {
      logger.error(`shutdown taking too long, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_FORCE_EXIT_MS);
    forceTimer.unref();

    try {
      server.close();
      // Stop accepting new ticks first, then await everything in flight.
      await stopAllLoops();
      await awaitAllSchedules();
      await closeDb();
    } catch (err) {
      logger.error('shutdown error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(forceTimer);
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('startup failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
