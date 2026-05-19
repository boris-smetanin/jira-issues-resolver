import type { ResolveAttempt } from '@jir/shared';
import { searchJql } from '../integrations/jira/jira.client.js';
import { scheduleAttempt } from '../orchestrator/scheduler.js';
import {
  createNextAttempt,
  findInFlightForIssue,
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

// Slice 5b: for each matching issue, create a QUEUED attempt and schedule
// the orchestrator to walk it through the state machine in the background
// (serial-per-Space via the scheduler). HTTP returns immediately with the
// list of created QUEUED attempts.
//
// AC: the FAILED / FINISHED / FINISHED_NO_CHANGES terminal state lands
// asynchronously — the UI polls `/api/spaces/:id/resolve-attempts` to see
// progress. Slice 7's SSE log stream will make this real-time.
export async function tickOnce(spaceId: string): Promise<TickResult> {
  const space = await findSpaceById(spaceId);
  if (!space) throw new TickError('Space not found', 404);
  if (!space.agentAccountId) {
    throw new TickError(
      'Space has no agent account assigned. Assign one in the Space detail page first.',
      400,
    );
  }

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

  // Single page of 50 issues per tick. Pagination via nextPageToken arrives
  // when slice 8's loop scheduler needs it.
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
    scheduleAttempt(attempt);
    created.push(attempt);
  }

  return { created, skipped };
}
