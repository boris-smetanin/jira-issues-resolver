import type { Space } from '@jir/shared';
import * as agentAccountsRepo from '../agent-accounts/agent-accounts.repository.js';
import { encrypt } from '../core/crypto.js';
import { lsRemote } from '../integrations/git/git.client.js';
import { AGENT_PROVIDERS } from '../integrations/agent-providers/registry.js';
import {
  GitHubAccessError,
  getRepo,
  parseGitHubRepoUrl,
} from '../integrations/github/github.client.js';
import {
  JiraCredentialError,
  searchJql,
  verifyCredential,
} from '../integrations/jira/jira.client.js';
import { allKnownIssueTypes } from '../orchestrator/issue-type-map.js';
import { notifyWorkerIntervalChanged } from '../resolve-loop/resolve-loop.service.js';
import { getSettings } from '../settings/settings.repository.js';
import type { CreateSpaceDto } from './dto/create-space.dto.js';
import type { UpdateSpaceDto } from './dto/update-space.dto.js';
import { buildJql } from './jql.builder.js';
import {
  create as repoCreate,
  findActiveById as repoFindActiveById,
  findById as repoFindById,
  findInternalActiveById as repoFindInternalActiveById,
  listActive as repoListActive,
  setAgentAccount as repoSetAgentAccount,
  updateEditableFields as repoUpdateEditableFields,
} from './spaces.repository.js';

export class ValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export async function listSpaces(): Promise<Space[]> {
  return repoListActive();
}

export async function findSpaceById(id: string): Promise<Space | null> {
  return repoFindActiveById(id);
}

// Used by attempt-history endpoints in later slices: returns even
// soft-deleted Spaces so their attempt rows can still resolve a Space.
export async function findSpaceByIdIncludingDeleted(id: string): Promise<Space | null> {
  return repoFindById(id);
}

async function assertAgentAccountUsable(
  agentAccountId: string,
  agentModel: string,
): Promise<void> {
  const account = await agentAccountsRepo.findById(agentAccountId);
  if (!account) {
    throw new ValidationError('agentAccountId', 'Agent account not found');
  }
  const config = AGENT_PROVIDERS[account.provider];
  if (!config?.enabled) {
    throw new ValidationError(
      'agentAccountId',
      `${config?.label ?? account.provider} is not enabled yet`,
    );
  }
  if (!config.models.includes(agentModel)) {
    throw new ValidationError(
      'agentModel',
      `Model "${agentModel}" is not valid for ${config.label}. ` +
        `Allowed: ${config.models.join(', ')}.`,
    );
  }
}

// Slice 10 polish: edit Space. Validates the agent account + model pair
// the same way createSpace does, re-runs the JQL-validity check against
// the Jira server so a typo'd filter is caught immediately rather than at
// the next tick, and notifies the in-flight loop worker if the tick
// interval changed. Doesn't re-run the GitHub repo check — the URL is
// fixed for this endpoint.
export async function updateSpace(spaceId: string, input: UpdateSpaceDto): Promise<Space> {
  const existing = await repoFindActiveById(spaceId);
  if (!existing) throw new ValidationError('id', 'Space not found');

  await assertAgentAccountUsable(input.agentAccountId, input.agentModel);

  const settings = await getSettings();
  if (!settings.jiraEmail || !settings.jiraApiToken || !settings.jiraBaseUrl) {
    throw new ValidationError(
      'jiraProject',
      'Jira global settings are not configured. Open Settings first.',
    );
  }
  const creds = {
    baseUrl: settings.jiraBaseUrl,
    email: settings.jiraEmail,
    token: settings.jiraApiToken,
  };

  const jql = buildJql({
    jiraProject: input.jiraProject,
    filterField: input.filterField,
    filterValue: input.filterValue,
    allowedStatuses: input.allowedStatuses,
    agentLabels: input.agentLabels,
    knownIssueTypes: allKnownIssueTypes(settings.issueTypeMap),
  });
  try {
    await searchJql(creds, { jql, maxResults: 1 });
  } catch (err) {
    if (err instanceof JiraCredentialError) {
      throw new ValidationError('filterValue', `Jira filter: ${err.message}`);
    }
    throw err;
  }

  // Slice 16b: figure out the encrypted npmrc value to persist:
  // - If the request omitted env name → both columns NULL.
  // - If env name set + value === '<UNCHANGED>' → keep the existing
  //   encrypted value (typical "form re-save without re-typing token"
  //   case).
  // - If env name set + value is a real token → encrypt + persist.
  const NPMRC_VALUE_UNCHANGED = '<UNCHANGED>';
  let npmrcEnvValueEnc: string | null = null;
  if (input.npmrcEnvName !== null && input.npmrcEnvName !== undefined) {
    if (input.npmrcEnvValue === NPMRC_VALUE_UNCHANGED) {
      // Read the existing encrypted value directly off the row.
      const internal = await repoFindInternalActiveById(spaceId);
      if (!internal?.npmrcEnvValue) {
        throw new ValidationError(
          'npmrcEnvValue',
          'No previously-saved value to preserve. Paste the token again.',
        );
      }
      npmrcEnvValueEnc = encrypt(internal.npmrcEnvValue);
    } else if (input.npmrcEnvValue !== null && input.npmrcEnvValue !== undefined) {
      npmrcEnvValueEnc = encrypt(input.npmrcEnvValue);
    }
  }

  const updated = await repoUpdateEditableFields(spaceId, {
    ...input,
    npmrcEnvName: input.npmrcEnvName ?? null,
    npmrcEnvValueEnc,
  });
  if (!updated) throw new ValidationError('id', 'Space not found');

  // If the interval changed and there's a running worker, push the new
  // interval to its in-memory sleep — otherwise the worker would keep
  // sleeping the old duration until the next process restart.
  if (input.tickIntervalSeconds !== existing.tickIntervalSeconds) {
    notifyWorkerIntervalChanged(spaceId, input.tickIntervalSeconds);
  }

  return updated;
}

export async function assignAgentAccount(
  spaceId: string,
  agentAccountId: string,
  agentModel: string,
): Promise<Space> {
  await assertAgentAccountUsable(agentAccountId, agentModel);
  const space = await repoSetAgentAccount(spaceId, agentAccountId);
  if (!space) {
    throw new ValidationError('id', 'Space not found');
  }
  return space;
}

export async function createSpace(input: CreateSpaceDto): Promise<Space> {
  // 1. Shape parse already happened in the controller. The other validations
  //    run in order; first failure short-circuits with a field-specific
  //    message.

  // 1a. Agent account must exist, be enabled, and the chosen model must
  //     match the account's provider.
  await assertAgentAccountUsable(input.agentAccountId, input.agentModel);

  // 2. Jira global credentials must exist + verify against /myself.
  const settings = await getSettings();
  if (!settings.jiraEmail || !settings.jiraApiToken || !settings.jiraBaseUrl) {
    throw new ValidationError(
      'jiraProject',
      'Jira global settings are not configured. Open Settings first.',
    );
  }
  const creds = {
    baseUrl: settings.jiraBaseUrl,
    email: settings.jiraEmail,
    token: settings.jiraApiToken,
  };
  try {
    await verifyCredential(creds);
  } catch (err) {
    if (err instanceof JiraCredentialError) {
      throw new ValidationError('jiraProject', `Jira: ${err.message}`);
    }
    throw err;
  }

  // 3. GitHub: PAT can read the repo.
  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseGitHubRepoUrl(input.githubRepoUrl));
  } catch (err) {
    throw new ValidationError(
      'githubRepoUrl',
      err instanceof Error ? err.message : String(err),
    );
  }
  try {
    await getRepo({ owner, repo, token: input.githubToken });
  } catch (err) {
    if (err instanceof GitHubAccessError) {
      throw new ValidationError('githubToken', `GitHub: ${err.message}`);
    }
    throw err;
  }

  // 4. JQL is well-formed + Jira accepts the filter combo. The enhanced
  //    /search/jql endpoint requires maxResults between 1 and 5000 (the
  //    classic /search allowed 0 as "count only"; this one doesn't). We
  //    fetch one issue purely to validate the query — the body is discarded.
  const jql = buildJql({
    jiraProject: input.jiraProject,
    filterField: input.filterField,
    filterValue: input.filterValue,
    allowedStatuses: input.allowedStatuses,
    agentLabels: input.agentLabels,
    knownIssueTypes: allKnownIssueTypes(settings.issueTypeMap),
  });
  try {
    await searchJql(creds, { jql, maxResults: 1 });
  } catch (err) {
    if (err instanceof JiraCredentialError) {
      throw new ValidationError('filterValue', `Jira filter: ${err.message}`);
    }
    throw err;
  }

  // 5. git ls-remote works (HTTPS clone reachable with this PAT).
  const ls = await lsRemote(input.githubRepoUrl, input.githubToken);
  if (!ls.ok) {
    throw new ValidationError('githubRepoUrl', `git ls-remote: ${ls.error}`);
  }

  return repoCreate({
    name: input.name,
    githubRepoUrl: input.githubRepoUrl,
    githubTokenEnc: encrypt(input.githubToken),
    githubCommitterName: input.githubCommitterName,
    githubCommitterEmail: input.githubCommitterEmail,
    baseBranch: input.baseBranch,
    agentAccountId: input.agentAccountId,
    agentModel: input.agentModel,
    jiraProject: input.jiraProject,
    filterField: input.filterField,
    filterValue: input.filterValue,
    allowedStatuses: input.allowedStatuses,
    agentLabels: input.agentLabels,
    targetStatusName: input.targetStatusName,
    tickIntervalSeconds: input.tickIntervalSeconds,
  });
}
