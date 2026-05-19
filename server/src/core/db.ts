import { ColumnType, Generated, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { config } from './config.js';

export interface SpacesTable {
  id: Generated<string>;
  name: string;
  github_repo_url: string;
  github_token_enc: string;
  github_committer_name: string;
  github_committer_email: string;
  base_branch: Generated<string>;
  agent_provider: 'claude' | 'codex';
  agent_model: string;
  agent_runtime_mode: Generated<'host' | 'container'>;
  dockerfile_content: string | null;
  jira_project: string;
  filter_field: 'component' | 'labels' | 'fixVersion';
  filter_value: string;
  allowed_statuses: string[];
  agent_labels: string[];
  target_status_name: string;
  tick_interval_seconds: Generated<number>;
  loop_running: Generated<boolean>;
  deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
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
