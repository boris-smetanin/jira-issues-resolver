export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
};

export type PullRequest = {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  head: { ref: string };
  base: { ref: string };
};

const GITHUB_HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function githubFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...GITHUB_HEADERS(token),
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    throw new GitHubAccessError(
      `could not reach GitHub at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
}

export class GitHubAccessError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubAccessError';
    this.status = status;
  }
}

const HTTPS_GITHUB_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

export function parseGitHubRepoUrl(url: string): { owner: string; repo: string } {
  const m = url.match(HTTPS_GITHUB_URL);
  if (!m) {
    throw new Error(
      `Not a valid GitHub HTTPS URL (expected https://github.com/<owner>/<repo>): ${url}`,
    );
  }
  return { owner: m[1]!, repo: m[2]! };
}

export async function getRepo({
  owner,
  repo,
  token,
}: {
  owner: string;
  repo: string;
  token: string;
}): Promise<GitHubRepo> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const res = await githubFetch(url, token);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubAccessError(
      `GitHub repo ${owner}/${repo}: ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  return (await res.json()) as GitHubRepo;
}

// Returns the first open PR for `<owner>:<branch>` (the head-filter format
// GitHub's API uses for same-repo PRs). Null if none.
export async function findPRByBranch(args: {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}): Promise<PullRequest | null> {
  const head = `${args.owner}:${args.branch}`;
  const url = `https://api.github.com/repos/${args.owner}/${args.repo}/pulls?head=${encodeURIComponent(head)}&state=open`;
  const res = await githubFetch(url, args.token);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubAccessError(
      `GitHub list-PRs ${args.owner}/${args.repo}: ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  const data = (await res.json()) as PullRequest[];
  return data[0] ?? null;
}

export async function createPR(args: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  token: string;
}): Promise<PullRequest> {
  const url = `https://api.github.com/repos/${args.owner}/${args.repo}/pulls`;
  const res = await githubFetch(url, args.token, {
    method: 'POST',
    body: JSON.stringify({
      title: args.title,
      body: args.body,
      head: args.head,
      base: args.base,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubAccessError(
      `GitHub create-PR ${args.owner}/${args.repo}: ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  return (await res.json()) as PullRequest;
}
