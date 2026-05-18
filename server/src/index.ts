import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './core/config.js';
import { closeDb } from './core/db.js';
import { logger } from './core/logger.js';
import { applyMigrations } from './migrations/runner.js';

async function main(): Promise<void> {
  await applyMigrations();
  const app = createApp();
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(`server listening on http://localhost:${info.port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`received ${signal}, shutting down`);
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('startup failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
