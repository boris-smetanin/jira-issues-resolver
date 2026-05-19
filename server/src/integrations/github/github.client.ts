export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
};

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
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (err) {
    throw new GitHubAccessError(
      `could not reach GitHub at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubAccessError(
      `GitHub repo ${owner}/${repo}: ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  return (await res.json()) as GitHubRepo;
}
