import { existsSync, rmSync } from 'node:fs';
import { mkdir as fsMkdir } from 'node:fs/promises';
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
