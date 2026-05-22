import type { Space } from '@jir/shared';
import type { Selectable } from 'kysely';
import { decrypt } from '../core/crypto.js';
import type { SpacesTable } from '../core/db.js';
import { getDb } from '../core/db.js';

// Internal-only — includes the decrypted GitHub token. Used by the
// orchestrator for git clone/fetch/push operations. Never serialise.
//
// Slice 16b: `npmrcEnvValue` is the decrypted token value (paired with
// `npmrcEnvName` from the public Space type) — passed to the dep-
// installer to authenticate private-package fetches. Null when the Space
// doesn't have npmrc auth configured.
export type InternalSpace = Space & {
  githubToken: string;
  dockerfileContent: string | null;
  npmrcEnvValue: string | null;
};

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
    lastTickAt: row.last_tick_at ? row.last_tick_at.toISOString() : null,
    npmrcEnvName: row.npmrc_env_name,
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

export async function findInternalActiveById(id: string): Promise<InternalSpace | null> {
  const row = await getDb()
    .selectFrom('spaces')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) return null;
  return {
    ...rowToSpace(row),
    githubToken: decrypt(row.github_token_enc),
    dockerfileContent: row.dockerfile_content,
    npmrcEnvValue: row.npmrc_env_value_enc ? decrypt(row.npmrc_env_value_enc) : null,
  };
}

// Slice 10 polish: edit the non-identity / non-creds fields. Returns the
// updated row or null if the Space doesn't exist (or is soft-deleted).
// Caller (spaces.service.updateSpace) is responsible for validating that
// agentAccountId + agentModel are usable and notifying the running loop
// worker if tickIntervalSeconds changed.
export async function updateEditableFields(
  spaceId: string,
  input: {
    name: string;
    baseBranch: string;
    githubCommitterName: string;
    githubCommitterEmail: string;
    agentAccountId: string;
    agentModel: string;
    tickIntervalSeconds: number;
    jiraProject: string;
    filterField: 'component' | 'labels' | 'fixVersion';
    filterValue: string;
    allowedStatuses: string[];
    agentLabels: string[];
    targetStatusName: string;
    // Slice 16b: optional npmrc auth. Either both set or both null —
    // caller validates the XOR; we just pass through. Empty/whitespace
    // values are normalised to null here as defence-in-depth (in case
    // the UI sends "" instead of omitting the field).
    npmrcEnvName: string | null;
    npmrcEnvValueEnc: string | null;
  },
): Promise<Space | null> {
  const normalisedEnvName =
    input.npmrcEnvName && input.npmrcEnvName.trim().length > 0 ? input.npmrcEnvName.trim() : null;
  const normalisedEnvValueEnc =
    normalisedEnvName !== null && input.npmrcEnvValueEnc ? input.npmrcEnvValueEnc : null;

  const row = await getDb()
    .updateTable('spaces')
    .set({
      name: input.name,
      base_branch: input.baseBranch,
      github_committer_name: input.githubCommitterName,
      github_committer_email: input.githubCommitterEmail,
      agent_account_id: input.agentAccountId,
      agent_model: input.agentModel,
      tick_interval_seconds: input.tickIntervalSeconds,
      jira_project: input.jiraProject,
      filter_field: input.filterField,
      filter_value: input.filterValue,
      allowed_statuses: input.allowedStatuses,
      agent_labels: input.agentLabels,
      target_status_name: input.targetStatusName,
      npmrc_env_name: normalisedEnvName,
      npmrc_env_value_enc: normalisedEnvValueEnc,
      updated_at: new Date(),
    })
    .where('id', '=', spaceId)
    .where('deleted_at', 'is', null)
    .returningAll()
    .executeTakeFirst();
  return row ? rowToSpace(row) : null;
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

export async function setLoopRunning(
  spaceId: string,
  running: boolean,
): Promise<Space | null> {
  const row = await getDb()
    .updateTable('spaces')
    .set({ loop_running: running, updated_at: new Date() })
    .where('id', '=', spaceId)
    .where('deleted_at', 'is', null)
    .returningAll()
    .executeTakeFirst();
  return row ? rowToSpace(row) : null;
}

export async function setTickInterval(
  spaceId: string,
  seconds: number,
): Promise<Space | null> {
  const row = await getDb()
    .updateTable('spaces')
    .set({ tick_interval_seconds: seconds, updated_at: new Date() })
    .where('id', '=', spaceId)
    .where('deleted_at', 'is', null)
    .returningAll()
    .executeTakeFirst();
  return row ? rowToSpace(row) : null;
}

export async function setLastTickAt(spaceId: string, at: Date): Promise<void> {
  await getDb()
    .updateTable('spaces')
    .set({ last_tick_at: at })
    .where('id', '=', spaceId)
    .where('deleted_at', 'is', null)
    .execute();
}

// Used at boot to resume any Space whose loop was running at the last
// graceful (or not-so-graceful) shutdown.
export async function findAllRunning(): Promise<Space[]> {
  const rows = await getDb()
    .selectFrom('spaces')
    .selectAll()
    .where('deleted_at', 'is', null)
    .where('loop_running', '=', true)
    .execute();
  return rows.map(rowToSpace);
}
