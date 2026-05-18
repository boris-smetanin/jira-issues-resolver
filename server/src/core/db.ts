import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { config } from './config.js';

export interface SpacesTable {
  id: string;
  name: string;
  created_at: Date;
}

export interface SettingsTable {
  id: number;
  jira_email: string | null;
  jira_api_token_enc: string | null;
  jira_base_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MigrationsTable {
  name: string;
  applied_at: Date;
}

export interface Database {
  spaces: SpacesTable;
  settings: SettingsTable;
  _migrations: MigrationsTable;
}

let pool: pg.Pool | undefined;
let db: Kysely<Database> | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

export function getDb(): Kysely<Database> {
  if (!db) {
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: getPool() }),
    });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = undefined;
    pool = undefined;
  }
}
