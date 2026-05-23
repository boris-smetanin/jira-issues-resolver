import type { IssueTypeMap } from '@jir/shared';
import { decrypt, encrypt } from '../core/crypto.js';
import { getDb } from '../core/db.js';

export type SettingsRow = {
  jiraEmail: string | null;
  jiraApiToken: string | null;
  jiraBaseUrl: string | null;
  globalConcurrencyCap: number;
  issueTypeMap: IssueTypeMap;
  logRetentionDays: number;
};

export async function getSettings(): Promise<SettingsRow> {
  const row = await getDb()
    .selectFrom('settings')
    .select([
      'jira_email',
      'jira_api_token_enc',
      'jira_base_url',
      'global_concurrency_cap',
      'bug_issue_types',
      'code_improvement_issue_types',
      'feature_issue_types',
      'log_retention_days',
    ])
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();

  return {
    jiraEmail: row.jira_email,
    jiraApiToken: row.jira_api_token_enc ? decrypt(row.jira_api_token_enc) : null,
    jiraBaseUrl: row.jira_base_url,
    globalConcurrencyCap: row.global_concurrency_cap,
    issueTypeMap: {
      bug: row.bug_issue_types,
      codeImprovement: row.code_improvement_issue_types,
      feature: row.feature_issue_types,
    },
    logRetentionDays: row.log_retention_days,
  };
}

export async function updateJiraCredentials(input: {
  email: string;
  apiToken: string;
  baseUrl: string;
}): Promise<void> {
  await getDb()
    .updateTable('settings')
    .set({
      jira_email: input.email,
      jira_api_token_enc: encrypt(input.apiToken),
      jira_base_url: input.baseUrl,
      updated_at: new Date(),
    })
    .where('id', '=', 1)
    .execute();
}

// Slice 16a: editable from /settings UI. Each list must contain at least
// one entry (validated in the service layer). Empty lists would silently
// disable a whole prompt shape — the JQL filter would exclude every issue
// of that type — which is almost certainly a config error.
export async function updateIssueTypeMap(input: IssueTypeMap): Promise<void> {
  await getDb()
    .updateTable('settings')
    .set({
      bug_issue_types: input.bug,
      code_improvement_issue_types: input.codeImprovement,
      feature_issue_types: input.feature,
      updated_at: new Date(),
    })
    .where('id', '=', 1)
    .execute();
}

// Slice 14: persist log retention days. Range is also enforced by the
// migration's CHECK constraint; the service layer pre-validates so the
// API returns 400 (not 500) on bad input.
export async function updateLogRetentionDays(days: number): Promise<void> {
  await getDb()
    .updateTable('settings')
    .set({
      log_retention_days: days,
      updated_at: new Date(),
    })
    .where('id', '=', 1)
    .execute();
}
