import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from '../core/db.js';
import { logger } from '../core/logger.js';

const MIGRATIONS_DIR = import.meta.dirname;

export async function applyMigrations(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query<{ name: string }>(
        'SELECT name FROM _migrations WHERE name = $1',
        [file],
      );
      if (rows.length > 0) {
        logger.debug(`migration already applied: ${file}`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      logger.info(`applying migration: ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
