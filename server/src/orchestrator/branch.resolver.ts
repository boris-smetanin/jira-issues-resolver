import { existsSync, rmSync } from 'node:fs';
import { mkdir as fsMkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config as appConfig } from '../core/config.js';
import {
  cloneRepo,
  configUser,
  fetchOrigin,
  lsRemoteBranch,
  worktreeAdd,
  worktreePrune,
  worktreeRemove,
} from '../integrations/git/git.client.js';
import type { InternalSpace } from '../spaces/spaces.repository.js';

export type PrepareWorktreeArgs = {
  space: InternalSpace;
  issueKey: string;
};

export type PrepareWorktreeResult = {
  cloneDir: string;
  worktreePath: string;
  // The ref the agent's commits will be measured against by commit.finalizer.
  // Either origin/<issueKey> (reopen branch already on remote) or
  // origin/<baseBranch> (fresh attempt).
  baseRef: string;
};

function repoDir(spaceId: string): string {
  return resolve(appConfig.dataDir, 'repos', spaceId);
}

function worktreePathFor(spaceId: string, issueKey: string): string {
  return resolve(appConfig.dataDir, 'repos', spaceId, 'wt', issueKey);
}

// Per Q10 in the design grilling: persistent clone per Space, worktree per
// (Space, issue). If an `origin/<issueKey>` branch already exists on the
// remote, the worktree starts from there (a reopen continues from the prior
// PR's branch). Otherwise it starts from `origin/<baseBranch>`.
export async function prepareWorktree(
  args: PrepareWorktreeArgs,
): Promise<PrepareWorktreeResult> {
  const cloneDir = repoDir(args.space.id);

  if (!existsSync(join(cloneDir, '.git'))) {
    await fsMkdir(join(appConfig.dataDir, 'repos'), { recursive: true });
    await cloneRepo({
      url: args.space.githubRepoUrl,
      token: args.space.githubToken,
      dest: cloneDir,
    });
  }

  await fetchOrigin(cloneDir, args.space.githubToken);

  // Slice 11: ensure `.sandcastle/` (the per-attempt Dockerfile dir
  // used by container-mode) is in the clone's .git/info/exclude so the
  // agent's `git status` doesn't see it. Worktrees inherit from the
  // parent .git/info/exclude. Idempotent: scans for the marker before
  // appending.
  await ensureSandcastleGitIgnored(cloneDir);

  const worktreePath = worktreePathFor(args.space.id, args.issueKey);

  // Slice 6 preserves the worktree on FAILED for debugging. Before a fresh
  // attempt re-uses the path, force-clean any stale state from the prior
  // failed run so `worktreeAdd` doesn't error with "path already exists".
  if (existsSync(worktreePath)) {
    try {
      await worktreeRemove(cloneDir, worktreePath);
    } catch {
      // Path exists but isn't registered as a worktree (or git refused) —
      // fall back to filesystem rm so we don't get stuck.
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }
  // Idempotent: prune any stale .git/worktrees entries left behind by a
  // crashed prior run. Best-effort.
  await worktreePrune(cloneDir).catch(() => undefined);

  const remoteBranchExists = await lsRemoteBranch(cloneDir, args.issueKey);
  const baseRef = remoteBranchExists
    ? `origin/${args.issueKey}`
    : `origin/${args.space.baseBranch}`;

  await worktreeAdd({
    repoDir: cloneDir,
    wtPath: worktreePath,
    branchName: args.issueKey,
    startPoint: baseRef,
  });

  await configUser(
    worktreePath,
    args.space.githubCommitterName,
    args.space.githubCommitterEmail,
  );

  return { cloneDir, worktreePath, baseRef };
}

// Slice 11: append `.sandcastle/` to the clone's `.git/info/exclude`
// if it isn't already there. Worktrees inherit from this file, so
// every per-attempt worktree's `git status` will ignore the
// per-attempt Dockerfile dir.
//
// Idempotent: scans the file's existing lines before appending. We
// never want to commit `.sandcastle/Dockerfile` — the agent
// container's Dockerfile is per-Space, generated, and unrelated to
// the user's source.
const SANDCASTLE_EXCLUDE_MARKER = '.sandcastle/';

async function ensureSandcastleGitIgnored(cloneDir: string): Promise<void> {
  const excludePath = join(cloneDir, '.git', 'info', 'exclude');
  let current = '';
  try {
    current = await readFile(excludePath, 'utf8');
  } catch {
    // .git/info/exclude is sometimes absent on freshly-cloned repos
    // depending on the git version's defaults — we'll create it.
  }
  if (current.split('\n').some((line) => line.trim() === SANDCASTLE_EXCLUDE_MARKER)) {
    return; // already excluded
  }
  const next =
    (current.endsWith('\n') || current === '' ? current : current + '\n') +
    `${SANDCASTLE_EXCLUDE_MARKER}\n`;
  await fsMkdir(join(cloneDir, '.git', 'info'), { recursive: true });
  await writeFile(excludePath, next);
}
