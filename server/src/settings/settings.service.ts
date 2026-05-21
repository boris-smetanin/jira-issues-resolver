import type { IssueTypeMap, JiraSettings } from '@jir/shared';
import { verifyCredential } from '../integrations/jira/jira.client.js';
import type { UpdateIssueTypeMapDto } from './dto/update-issue-type-map.dto.js';
import type { UpdateJiraCredentialDto } from './dto/update-jira-credential.dto.js';
import {
  getSettings,
  updateIssueTypeMap as repoUpdateIssueTypeMap,
  updateJiraCredentials,
} from './settings.repository.js';

function redact(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 4) return '••••';
  return '••••••••' + token.slice(-4);
}

export async function getJiraSettings(): Promise<JiraSettings> {
  const s = await getSettings();
  return {
    email: s.jiraEmail,
    redactedToken: redact(s.jiraApiToken),
    baseUrl: s.jiraBaseUrl,
    connected: Boolean(s.jiraEmail && s.jiraApiToken && s.jiraBaseUrl),
  };
}

export async function setJiraSettings(
  input: UpdateJiraCredentialDto,
): Promise<{ connectedAs: string }> {
  const { displayName } = await verifyCredential({
    baseUrl: input.baseUrl,
    email: input.email,
    token: input.apiToken,
  });
  await updateJiraCredentials({
    email: input.email,
    apiToken: input.apiToken,
    baseUrl: input.baseUrl,
  });
  return { connectedAs: displayName };
}

// Slice 16a: read the issue-type → prompt-shape map. Used by callers that
// need to dispatch by shape (orchestrator) or build JQL filters (resolve-
// loop service), plus the Settings UI to render the current values.
export async function getIssueTypeMap(): Promise<IssueTypeMap> {
  const s = await getSettings();
  return s.issueTypeMap;
}

export async function setIssueTypeMap(input: UpdateIssueTypeMapDto): Promise<IssueTypeMap> {
  await repoUpdateIssueTypeMap(input);
  return input;
}
