type Myself = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
};

export type JiraVerifyResult = {
  accountId: string;
  displayName: string;
};

export class JiraCredentialError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'JiraCredentialError';
    this.status = status;
  }
}

export async function verifyCredential({
  baseUrl,
  email,
  token,
}: {
  baseUrl: string;
  email: string;
  token: string;
}): Promise<JiraVerifyResult> {
  const auth = Buffer.from(`${email}:${token}`, 'utf8').toString('base64');
  const url = `${baseUrl}/rest/api/3/myself`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new JiraCredentialError(
      `could not reach Jira at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
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
