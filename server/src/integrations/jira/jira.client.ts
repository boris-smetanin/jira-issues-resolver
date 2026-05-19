type Myself = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
};

export type JiraVerifyResult = {
  accountId: string;
  displayName: string;
};

export type JiraSearchResult = {
  issues: Array<{
    key: string;
    fields?: Record<string, unknown>;
  }>;
  isLast?: boolean;
  nextPageToken?: string;
};

export class JiraCredentialError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'JiraCredentialError';
    this.status = status;
  }
}

type JiraCreds = { baseUrl: string; email: string; token: string };

async function jiraRequest(
  creds: JiraCreds,
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<Response> {
  const { baseUrl, email, token } = creds;
  const url = `${baseUrl}${path}`;
  const auth = Buffer.from(`${email}:${token}`, 'utf8').toString('base64');
  const body = init?.body;
  try {
    return await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new JiraCredentialError(
      `could not reach Jira at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
}

export async function verifyCredential(creds: JiraCreds): Promise<JiraVerifyResult> {
  const res = await jiraRequest(creds, '/rest/api/3/myself');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new JiraCredentialError(
      `Jira /myself returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  const data = (await res.json()) as Myself;
  return { accountId: data.accountId, displayName: data.displayName };
}

// Uses the enhanced search endpoint (`/rest/api/3/search/jql`). The classic
// `/rest/api/3/search` was deprecated by Atlassian in Oct 2024 and removed in
// May 2025; new code must use the JQL endpoint.
export async function searchJql(
  creds: JiraCreds,
  args: { jql: string; maxResults: number },
): Promise<JiraSearchResult> {
  const res = await jiraRequest(creds, '/rest/api/3/search/jql', {
    method: 'POST',
    body: { jql: args.jql, maxResults: args.maxResults, fields: ['summary'] },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new JiraCredentialError(
      `Jira /search/jql returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`,
      res.status,
    );
  }
  return (await res.json()) as JiraSearchResult;
}
