import { decrypt, encrypt } from '../core/crypto.js';
import { getDb } from '../core/db.js';

export type SettingsRow = {
  jiraEmail: string | null;
  jiraApiToken: string | null;
  jiraBaseUrl: string | null;
};

export async function getSettings(): Promise<SettingsRow> {
  const row = await getDb()
    .selectFrom('settings')
    .select(['jira_email', 'jira_api_token_enc', 'jira_base_url'])
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();

  return {
    jiraEmail: row.jira_email,
    jiraApiToken: row.jira_api_token_enc ? decrypt(row.jira_api_token_enc) : null,
    jiraBaseUrl: row.jira_base_url,
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
