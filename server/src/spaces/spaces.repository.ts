import type { Space } from '@jir/shared';
import type { Selectable } from 'kysely';
import type { SpacesTable } from '../core/db.js';
import { getDb } from '../core/db.js';

type SpaceRow = Selectable<SpacesTable>;

function rowToSpace(row: SpaceRow): Space {
  return {
    id: row.id,
    name: row.name,
    githubRepoUrl: row.github_repo_url,
    githubCommitterName: row.github_committer_name,
    githubCommitterEmail: row.github_committer_email,
    baseBranch: row.base_branch,
    agentAccountId: row.agent_account_id,
    agentModel: row.agent_model,
    agentRuntimeMode: row.agent_runtime_mode,
    jiraProject: row.jira_project,
    filterField: row.filter_field,
    filterValue: row.filter_value,
    allowedStatuses: row.allowed_statuses,
    agentLabels: row.agent_labels,
    targetStatusName: row.target_status_name,
    tickIntervalSeconds: row.tick_interval_seconds,
    loopRunning: row.loop_running,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export type CreateSpaceInput = {
  name: string;
  githubRepoUrl: string;
  githubTokenEnc: string;
  githubCommitterName: string;
  githubCommitterEmail: string;
  baseBranch: string;
  agentAccountId: string;
  agentModel: string;
  jiraProject: string;
  filterField: 'component' | 'labels' | 'fixVersion';
  filterValue: string;
  allowedStatuses: string[];
  agentLabels: string[];
  targetStatusName: string;
  tickIntervalSeconds: number;
};

export async function create(input: CreateSpaceInput): Promise<Space> {
  const row = await getDb()
    .insertInto('spaces')
    .values({
      name: input.name,
      github_repo_url: input.githubRepoUrl,
      github_token_enc: input.githubTokenEnc,
      github_committer_name: input.githubCommitterName,
      github_committer_email: input.githubCommitterEmail,
      base_branch: input.baseBranch,
      agent_account_id: input.agentAccountId,
      agent_model: input.agentModel,
      jira_project: input.jiraProject,
      filter_field: input.filterField,
      filter_value: input.filterValue,
      allowed_statuses: input.allowedStatuses,
      agent_labels: input.agentLabels,
      target_status_name: input.targetStatusName,
      tick_interval_seconds: input.tickIntervalSeconds,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return rowToSpace(row);
}

export async function findActiveById(id: string): Promise<Space | null> {
  const row = await getDb()
    .selectFrom('spaces')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row ? rowToSpace(row) : null;
}

// AC #4: soft-deleted Spaces remain queryable by ID (this method ignores
// deleted_at). Used by attempt history pages in later slices.
export async function findById(id: string): Promise<Space | null> {
  const row = await getDb()
    .selectFrom('spaces')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? rowToSpace(row) : null;
}

export async function listActive(): Promise<Space[]> {
  const rows = await getDb()
    .selectFrom('spaces')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map(rowToSpace);
}

export async function setAgentAccount(
  spaceId: string,
  agentAccountId: string,
): Promise<Space | null> {
  const row = await getDb()
    .updateTable('spaces')
    .set({ agent_account_id: agentAccountId, updated_at: new Date() })
    .where('id', '=', spaceId)
    .where('deleted_at', 'is', null)
    .returningAll()
    .executeTakeFirst();
  return row ? rowToSpace(row) : null;
}
