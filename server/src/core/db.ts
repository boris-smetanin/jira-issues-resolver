import { ColumnType, Generated, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { config } from './config.js';

export type AttemptStatusDb =
  | 'QUEUED'
  | 'PREPARING_REPO'
  | 'AGENT_RUNNING'
  | 'CHECKING_COMMITS'
  | 'PUSHING'
  | 'OPENING_PR'
  | 'TRANSITIONING_JIRA'
  | 'FINISHED'
  | 'FINISHED_NO_CHANGES'
  | 'FAILED'
  | 'ESCALATED';

export type PromptShapeDb = 'bug' | 'code-improvement' | 'feature';

export type AgentProviderDb = 'claude' | 'codex';

export interface AgentAccountsTable {
  id: Generated<string>;
  provider: AgentProviderDb;
  name: string;
  api_key_enc: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SpacesTable {
  id: Generated<string>;
  name: string;
  github_repo_url: string;
  github_token_enc: string;
  github_committer_name: string;
  github_committer_email: string;
  base_branch: Generated<string>;
  agent_account_id: ColumnType<string | null, string | null | undefined, string | null>;
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
  last_tick_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  // Slice 16b: optional npmrc env-var for private-package installs in
  // code-improvement-shape attempts.
  npmrc_env_name: ColumnType<string | null, string | null | undefined, string | null>;
  npmrc_env_value_enc: ColumnType<string | null, string | null | undefined, string | null>;
  deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ResolveAttemptsTable {
  id: Generated<string>;
  space_id: string;
  issue_key: string;
  attempt_number: number;
  prior_attempt_id: string | null;
  status: AttemptStatusDb;
  branch_name: string | null;
  pr_url: string | null;
  pr_number: number | null;
  error_reason: string | null;
  stuck_at_status: string | null;
  transition_warning: string | null;
  log_file_path: string | null;
  prompt_rendered: string | null;
  escalation_md: string | null;
  deps_installed_for_attempt: Generated<boolean>;
  prompt_shape: ColumnType<PromptShapeDb | null, PromptShapeDb | null | undefined, PromptShapeDb | null>;
  started_at: Generated<Date>;
  ended_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

export interface SettingsTable {
  id: number;
  jira_email: string | null;
  jira_api_token_enc: string | null;
  jira_base_url: string | null;
  global_concurrency_cap: Generated<number>;
  bug_issue_types: Generated<string[]>;
  code_improvement_issue_types: Generated<string[]>;
  feature_issue_types: Generated<string[]>;
  created_at: Date;
  updated_at: Date;
}

export interface MigrationsTable {
  name: string;
  applied_at: Date;
}

export interface Database {
  agent_accounts: AgentAccountsTable;
  spaces: SpacesTable;
  resolve_attempts: ResolveAttemptsTable;
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
