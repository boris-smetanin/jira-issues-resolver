import type { ResolveAttempt } from '@jir/shared';
import { searchJql } from '../integrations/jira/jira.client.js';
import {
  createNextAttempt,
  findInFlightForIssue,
  markFinishedNoChanges,
} from '../resolve-attempts/resolve-attempts.service.js';
import { getSettings } from '../settings/settings.repository.js';
import { buildJql } from '../spaces/jql.builder.js';
import { findSpaceById } from '../spaces/spaces.service.js';

export class TickError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TickError';
    this.status = status;
  }
}

export type TickResult = {
  created: ResolveAttempt[];
  skipped: Array<{ issueKey: string; reason: string }>;
};

// Slice 4 stub: every created attempt is immediately marked
// FINISHED_NO_CHANGES — no agent, no git, no GitHub/Jira writes.
// Slice 5 replaces the placeholder with the real orchestrator.
export async function tickOnce(spaceId: string): Promise<TickResult> {
  const space = await findSpaceById(spaceId);
  if (!space) throw new TickError('Space not found', 404);

  const settings = await getSettings();
  if (!settings.jiraEmail || !settings.jiraApiToken || !settings.jiraBaseUrl) {
    throw new TickError('Jira global settings are not configured. Open Settings first.', 400);
  }
  const creds = {
    baseUrl: settings.jiraBaseUrl,
    email: settings.jiraEmail,
    token: settings.jiraApiToken,
  };

  const jql = buildJql({
    jiraProject: space.jiraProject,
    filterField: space.filterField,
    filterValue: space.filterValue,
    allowedStatuses: space.allowedStatuses,
    agentLabels: space.agentLabels,
  });

  // Single page of 50 issues per tick. Slice 5+ will paginate via
  // nextPageToken when the loop encounters more matching issues than fit.
  const result = await searchJql(creds, { jql, maxResults: 50 });

  const created: ResolveAttempt[] = [];
  const skipped: Array<{ issueKey: string; reason: string }> = [];

  for (const issue of result.issues) {
    const issueKey = issue.key;
    const inFlight = await findInFlightForIssue(space.id, issueKey);
    if (inFlight) {
      skipped.push({
        issueKey,
        reason: `in-flight attempt ${inFlight.id} (${inFlight.status})`,
      });
      continue;
    }
    const attempt = await createNextAttempt({ spaceId: space.id, issueKey });
    const terminal = await markFinishedNoChanges(attempt.id);
    created.push(terminal);
  }

  return { created, skipped };
}
