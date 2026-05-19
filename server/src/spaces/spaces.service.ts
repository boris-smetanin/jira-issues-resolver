import type { Space } from '@jir/shared';
import { encrypt } from '../core/crypto.js';
import { lsRemote } from '../integrations/git/git.client.js';
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
import { getSettings } from '../settings/settings.repository.js';
import type { CreateSpaceDto } from './dto/create-space.dto.js';
import { buildJql } from './jql.builder.js';
import {
  create as repoCreate,
  findActiveById as repoFindActiveById,
  findById as repoFindById,
  listActive as repoListActive,
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

export async function createSpace(input: CreateSpaceDto): Promise<Space> {
  // 1. Shape parse already happened in the controller. The other four
  //    validations run in order; first failure short-circuits with a
  //    field-specific message.

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
    agentProvider: input.agentProvider,
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
