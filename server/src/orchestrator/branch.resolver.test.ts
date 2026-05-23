import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../core/config.js';
import type { InternalSpace } from '../spaces/spaces.repository.js';
import { tmpGitRepo, type TmpGitRepo } from '../__test__/tmpGitRepo.js';
import { prepareWorktree } from './branch.resolver.js';

const execFileP = promisify(execFile);

// Slice 0013: Core 4 — Branch Resolver tests.
//
// All four scenarios from the spec, exercised against a real git
// binary on a tmp repo. No mocks of git, no shelling-out interception
// — we rely on the actual git client + the actual filesystem.
//
// Each test:
//   1. Spins up a fresh remote+seed via tmpGitRepo()
//   2. Points appConfig.dataDir at a fresh tmp dir so the clone +
//      worktree land somewhere isolated (NOT the tmpGitRepo's own
//      tree, which has its own .git state).
//   3. Builds a minimal InternalSpace pointing at the tmp remote.
//   4. Calls prepareWorktree and asserts the resulting state.

function makeSpace(repo: TmpGitRepo, overrides: Partial<InternalSpace> = {}): InternalSpace {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'test-space',
    githubRepoUrl: repo.remoteUrl,
    githubToken: 'dummy-token-not-used-for-local-clones',
    githubCommitterName: 'Test User',
    githubCommitterEmail: 'test@example.com',
    baseBranch: repo.baseBranch,
    agentAccountId: null,
    agentModel: '',
    agentRuntimeMode: 'host',
    jiraProject: 'TST',
    filterField: 'labels',
    filterValue: 'agent',
    allowedStatuses: ['In Progress'],
    agentLabels: ['agent'],
    targetStatusName: 'Done',
    tickIntervalSeconds: 60,
    loopRunning: false,
    lastTickAt: null,
    dockerfileContent: null,
    npmrcEnvName: null,
    npmrcEnvValue: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('prepareWorktree', () => {
  let repo: TmpGitRepo;
  let dataDirTmp: string;
  let prevDataDir: string;

  beforeEach(async () => {
    repo = await tmpGitRepo({ baseBranch: 'main' });
    dataDirTmp = await mkdtemp(join(tmpdir(), 'jir-data-'));
    prevDataDir = config.dataDir;
    config.dataDir = dataDirTmp;
  });

  afterEach(async () => {
    config.dataDir = prevDataDir;
    await repo.cleanup();
    await rm(dataDirTmp, { recursive: true, force: true });
  });

  it('creates the persistent clone on first call when it does not exist', async () => {
    const space = makeSpace(repo);
    expect(existsSync(join(dataDirTmp, 'repos', space.id, '.git'))).toBe(false);

    await prepareWorktree({ space, issueKey: 'RND-1' });

    expect(existsSync(join(dataDirTmp, 'repos', space.id, '.git'))).toBe(true);
  });

  it('starts the worktree off origin/<baseBranch> when origin/<issueKey> does not exist', async () => {
    const space = makeSpace(repo);

    const { worktreePath, baseRef, cloneDir } = await prepareWorktree({
      space,
      issueKey: 'RND-1',
    });

    expect(baseRef).toBe(`origin/${space.baseBranch}`);
    expect(existsSync(worktreePath)).toBe(true);

    // Working tree is clean (no untracked/modified files from setup).
    const { stdout: status } = await execFileP('git', ['-C', worktreePath, 'status', '--porcelain']);
    expect(status.trim()).toBe('');

    // HEAD matches origin/<base>.
    const { stdout: head } = await execFileP('git', ['-C', worktreePath, 'rev-parse', 'HEAD']);
    const { stdout: originHead } = await execFileP('git', [
      '-C',
      cloneDir,
      'rev-parse',
      `origin/${space.baseBranch}`,
    ]);
    expect(head.trim()).toBe(originHead.trim());
  });

  it('starts the worktree off origin/<issueKey> when that ref exists on the remote', async () => {
    const space = makeSpace(repo);
    const branchSha = await repo.pushBranch('RND-2');

    const { worktreePath, baseRef, cloneDir } = await prepareWorktree({
      space,
      issueKey: 'RND-2',
    });

    expect(baseRef).toBe('origin/RND-2');

    // HEAD matches the remote branch's tip (the commit we just pushed).
    const { stdout: head } = await execFileP('git', ['-C', worktreePath, 'rev-parse', 'HEAD']);
    expect(head.trim()).toBe(branchSha);

    // The file we pushed to RND-2 is present in the worktree.
    expect(existsSync(join(worktreePath, 'RND-2.txt'))).toBe(true);

    // Sanity: the worktree's local branch is named after the issue key.
    const { stdout: currentBranch } = await execFileP('git', [
      '-C',
      worktreePath,
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ]);
    expect(currentBranch.trim()).toBe('RND-2');
    void cloneDir;
  });

  it('replaces a stale worktree from a prior call without leaking state', async () => {
    const space = makeSpace(repo);

    // First call leaves a worktree on disk.
    const first = await prepareWorktree({ space, issueKey: 'RND-3' });
    // Simulate the agent leaving a dirty file behind.
    await writeFile(join(first.worktreePath, 'leftover.txt'), 'should not survive\n');
    expect(existsSync(join(first.worktreePath, 'leftover.txt'))).toBe(true);

    // Second call: same issueKey → must clean up and create fresh.
    const second = await prepareWorktree({ space, issueKey: 'RND-3' });

    expect(second.worktreePath).toBe(first.worktreePath);
    expect(existsSync(join(second.worktreePath, 'leftover.txt'))).toBe(false);

    // Working tree is clean.
    const { stdout: status } = await execFileP('git', [
      '-C',
      second.worktreePath,
      'status',
      '--porcelain',
    ]);
    expect(status.trim()).toBe('');
  });

  it('adds `.sandcastle/` to the clone\'s .git/info/exclude (idempotent)', async () => {
    const space = makeSpace(repo);

    await prepareWorktree({ space, issueKey: 'RND-4' });
    const excludePath = join(dataDirTmp, 'repos', space.id, '.git', 'info', 'exclude');
    const after1 = readFileSync(excludePath, 'utf8');
    expect(after1).toMatch(/^\.sandcastle\/$/m);

    // Calling again must NOT append a duplicate.
    await prepareWorktree({ space, issueKey: 'RND-4' });
    const after2 = readFileSync(excludePath, 'utf8');
    const occurrences = after2.split('\n').filter((line) => line.trim() === '.sandcastle/').length;
    expect(occurrences).toBe(1);
  });

  it('configures user.name and user.email on the worktree', async () => {
    const space = makeSpace(repo, {
      githubCommitterName: 'Alice Resolver',
      githubCommitterEmail: 'alice@example.com',
    });

    const { worktreePath } = await prepareWorktree({ space, issueKey: 'RND-5' });

    const { stdout: name } = await execFileP('git', [
      '-C',
      worktreePath,
      'config',
      'user.name',
    ]);
    const { stdout: email } = await execFileP('git', [
      '-C',
      worktreePath,
      'config',
      'user.email',
    ]);
    expect(name.trim()).toBe('Alice Resolver');
    expect(email.trim()).toBe('alice@example.com');
  });
});
