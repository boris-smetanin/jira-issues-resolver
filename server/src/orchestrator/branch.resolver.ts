import { existsSync } from 'node:fs';
import { mkdir as fsMkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config as appConfig } from '../core/config.js';
import {
  cloneRepo,
  configUser,
  fetchOrigin,
  lsRemoteBranch,
  worktreeAdd,
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

  const remoteBranchExists = await lsRemoteBranch(cloneDir, args.issueKey);
  const baseRef = remoteBranchExists
    ? `origin/${args.issueKey}`
    : `origin/${args.space.baseBranch}`;

  const worktreePath = worktreePathFor(args.space.id, args.issueKey);
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
