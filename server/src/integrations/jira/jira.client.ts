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

// ADF (Atlassian Document Format) value. Opaque JSON tree.
export type AdfDoc = { type: string; version?: number; content?: unknown[] };

export type JiraIssue = {
  key: string;
  summary: string;
  status: string;
  // Slice 16a: drives prompt-shape dispatch and JQL filtering. Empty
  // string if Jira returned an issue without a parsable issuetype (very
  // unusual; defensive).
  issuetype: string;
  descriptionAdf: AdfDoc | null;
};

export type JiraComment = {
  id: string;
  author: string;
  createdAt: string;
  bodyAdf: AdfDoc | null;
};

export type JiraTransition = {
  id: string;
  name: string;
  to: { id: string; name: string };
};

export class JiraCredentialError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'JiraCredentialError';
    this.status = status;
  }
}

export type JiraCreds = { baseUrl: string; email: string; token: string };

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

export async function getIssue(creds: JiraCreds, key: string): Promise<JiraIssue> {
  const res = await jiraRequest(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,description,issuetype`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new JiraCredentialError(
      `Jira /issue/${key} returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  const data = (await res.json()) as {
    key: string;
    fields: {
      summary?: string;
      status?: { name?: string };
      description?: AdfDoc | null;
      issuetype?: { name?: string };
    };
  };
  return {
    key: data.key,
    summary: data.fields.summary ?? '',
    status: data.fields.status?.name ?? '',
    issuetype: data.fields.issuetype?.name ?? '',
    descriptionAdf: data.fields.description ?? null,
  };
}

export async function getComments(creds: JiraCreds, key: string): Promise<JiraComment[]> {
  const res = await jiraRequest(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(key)}/comment?orderBy=created`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new JiraCredentialError(
      `Jira /issue/${key}/comment returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  const data = (await res.json()) as {
    comments: Array<{
      id: string;
      author?: { displayName?: string };
      created: string;
      body?: AdfDoc | null;
    }>;
  };
  return data.comments.map((c) => ({
    id: c.id,
    author: c.author?.displayName ?? 'unknown',
    createdAt: c.created,
    bodyAdf: c.body ?? null,
  }));
}

export async function listTransitions(creds: JiraCreds, key: string): Promise<JiraTransition[]> {
  const res = await jiraRequest(creds, `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new JiraCredentialError(
      `Jira /issue/${key}/transitions returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  const data = (await res.json()) as { transitions: JiraTransition[] };
  return data.transitions;
}

export async function transitionIssue(
  creds: JiraCreds,
  key: string,
  transitionId: string,
): Promise<void> {
  const res = await jiraRequest(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
    {
      method: 'POST',
      body: { transition: { id: transitionId } },
    },
  );
  // 204 No Content on success.
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new JiraCredentialError(
      `Jira transitionIssue(${key}) returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
}
