import { execFile, execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tmpGitRepo, type TmpGitRepo } from '../__test__/tmpGitRepo.js';
import { finalize, type FinalizeResult } from './commit.finalizer.js';

const execFileP = promisify(execFile);

// Slice 0013: Core 4 — Commit Finalizer tests.
//
// Uses a real git binary against a tmp repo (no mocks). The
// `seedDir` working clone IS the "worktree" the orchestrator would
// give to the agent — that's structurally close enough; the
// finalizer doesn't care that it's a worktree vs a plain clone, it
// just walks revs and squashes.
//
// Each test:
//   1. Spins up a fresh remote+seed
//   2. Records `baseRef` (origin/main's HEAD sha at setup time) so
//      revList sees post-baseline commits even after agent activity
//   3. Makes 0..N "agent" commits on top of baseRef
//   4. Calls finalize() and asserts both the FinalizeResult and the
//      resulting git state via real git commands

const ISSUE_KEY = 'RND-7';
const ATTEMPT_ID = 'cafebabe-0000-0000-0000-000000000001';
const PRIOR_ATTEMPT_ID = 'deadbeef-1111-2222-3333-444444444444';

// Author the "agent" commits with a Test User identity on the seed
// clone — the configUser call in tmpGitRepo sets it.

async function addCommit(
  wt: string,
  args: { file: string; content: string; message: string },
): Promise<string> {
  await writeFile(join(wt, args.file), args.content);
  await execFileP('git', ['-C', wt, 'add', args.file]);
  await execFileP('git', ['-C', wt, 'commit', '-m', args.message]);
  const { stdout } = await execFileP('git', ['-C', wt, 'rev-parse', 'HEAD']);
  return stdout.trim();
}

async function readMessage(wt: string, ref = 'HEAD'): Promise<string> {
  const { stdout } = await execFileP('git', ['-C', wt, 'log', '-1', '--pretty=format:%B', ref]);
  return stdout;
}

async function headSha(wt: string): Promise<string> {
  const { stdout } = await execFileP('git', ['-C', wt, 'rev-parse', 'HEAD']);
  return stdout.trim();
}

async function countCommitsSince(wt: string, base: string): Promise<number> {
  const { stdout } = await execFileP('git', ['-C', wt, 'rev-list', '--count', `${base}..HEAD`]);
  return Number(stdout.trim());
}

describe('finalize', () => {
  let repo: TmpGitRepo;
  let wt: string;
  let baseRef: string;
  let baseSha: string;

  beforeEach(async () => {
    repo = await tmpGitRepo({ baseBranch: 'main' });
    wt = repo.seedDir;
    // Use the literal sha (not a symbolic ref) as baseRef so it's
    // immune to anything in the seed clone moving HEAD around mid-
    // test. The orchestrator uses origin/<branch> for the same
    // purpose; equivalent for our assertions.
    baseSha = (await execFileP('git', ['-C', wt, 'rev-parse', 'HEAD'])).stdout.trim();
    baseRef = baseSha;
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it('zero new commits → { commits: 0 } and HEAD unchanged', async () => {
    const before = await headSha(wt);
    const result: FinalizeResult = await finalize({
      worktreePath: wt,
      baseRef,
      issueKey: ISSUE_KEY,
      attemptId: ATTEMPT_ID,
    });

    expect(result).toEqual({ commits: 0 });
    expect(await headSha(wt)).toBe(before);
  });

  it('one commit, subject NOT prefixed → squash prepends the issue key', async () => {
    await addCommit(wt, { file: 'a.txt', content: '1\n', message: 'Fix bug' });

    const result = await finalize({
      worktreePath: wt,
      baseRef,
      issueKey: ISSUE_KEY,
      attemptId: ATTEMPT_ID,
    });

    expect(result.commits).toBe(1);
    expect(await countCommitsSince(wt, baseRef)).toBe(1);
    const msg = await readMessage(wt);
    expect(msg.startsWith(`${ISSUE_KEY} Fix bug`)).toBe(true);
    expect(msg).toContain(`Resolve-Attempt: ${ATTEMPT_ID}`);
  });

  it('one commit, subject already prefixed → dedupes the prefix', async () => {
    await addCommit(wt, { file: 'a.txt', content: '1\n', message: `${ISSUE_KEY} Fix bug` });

    const result = await finalize({
      worktreePath: wt,
      baseRef,
      issueKey: ISSUE_KEY,
      attemptId: ATTEMPT_ID,
    });

    expect(result.commits).toBe(1);
    const msg = await readMessage(wt);
    expect(msg).toMatch(new RegExp(`^${ISSUE_KEY} Fix bug\\n`));
    // The double-prefix would be `RND-7 RND-7 Fix bug` — assert NOT.
    expect(msg).not.toMatch(new RegExp(`^${ISSUE_KEY} ${ISSUE_KEY}`));
  });

  it('three commits → squashed to one using the last subject', async () => {
    await addCommit(wt, { file: 'a.txt', content: 'a\n', message: 'step 1' });
    await addCommit(wt, { file: 'b.txt', content: 'b\n', message: 'step 2' });
    await addCommit(wt, { file: 'c.txt', content: 'c\n', message: 'step 3' });

    const result = await finalize({
      worktreePath: wt,
      baseRef,
      issueKey: ISSUE_KEY,
      attemptId: ATTEMPT_ID,
    });

    expect(result.commits).toBe(1);
    expect(await countCommitsSince(wt, baseRef)).toBe(1);
    const msg = await readMessage(wt);
    expect(msg.startsWith(`${ISSUE_KEY} step 3`)).toBe(true);
    // HEAD~1 is the original base.
    const { stdout: parent } = await execFileP('git', ['-C', wt, 'rev-parse', 'HEAD~1']);
    expect(parent.trim()).toBe(baseSha);
  });

  it('priorAttemptId emits a machine-parseable Prior-Attempt trailer', async () => {
    await addCommit(wt, { file: 'a.txt', content: '1\n', message: 'Re-fix bug' });

    await finalize({
      worktreePath: wt,
      baseRef,
      issueKey: ISSUE_KEY,
      attemptId: ATTEMPT_ID,
      priorAttemptId: PRIOR_ATTEMPT_ID,
    });

    // Parse trailers via git's own parser — guarantees we emitted them in
    // a format that `git interpret-trailers --parse` recognises. We use
    // execFileSync here because the promisified execFile doesn't pipe
    // `input` to stdin (git would hang waiting for EOF).
    const parsed = execFileSync(
      'git',
      ['-C', wt, 'interpret-trailers', '--only-trailers', '--parse'],
      { input: await readMessage(wt), encoding: 'utf8' },
    );
    const trailers = parsed.trim().split('\n');
    expect(trailers).toContain(`Resolve-Attempt: ${ATTEMPT_ID}`);
    expect(trailers).toContain(`Prior-Attempt: ${PRIOR_ATTEMPT_ID}`);
  });

  it('untracked files in the worktree are NOT included in the squashed commit', async () => {
    await addCommit(wt, { file: 'a.txt', content: 'a\n', message: 'real change' });
    // Leave an untracked file behind.
    await writeFile(join(wt, 'leftover.txt'), 'should not be in commit\n');

    await finalize({
      worktreePath: wt,
      baseRef,
      issueKey: ISSUE_KEY,
      attemptId: ATTEMPT_ID,
    });

    const { stdout: files } = await execFileP('git', [
      '-C',
      wt,
      'show',
      '--name-only',
      '--pretty=format:',
      'HEAD',
    ]);
    const changed = files.trim().split('\n').filter(Boolean);
    expect(changed).toEqual(['a.txt']);

    // The leftover is still on disk, just untracked.
    const { stdout: status } = await execFileP('git', ['-C', wt, 'status', '--porcelain']);
    expect(status).toContain('?? leftover.txt');
  });

  it('empty subject → falls back to "<ISSUE-KEY> resolve attempt"', async () => {
    // Stage a change with an empty commit message. --allow-empty-message
    // matches what the agent's mock client uses when emitting commits.
    await writeFile(join(wt, 'a.txt'), 'a\n');
    await execFileP('git', ['-C', wt, 'add', 'a.txt']);
    await execFileP('git', ['-C', wt, 'commit', '--allow-empty-message', '-m', '']);

    await finalize({
      worktreePath: wt,
      baseRef,
      issueKey: ISSUE_KEY,
      attemptId: ATTEMPT_ID,
    });

    const msg = await readMessage(wt);
    // Implementation uses 'resolve attempt' (no <N>), then the
    // finalizer prepends '<ISSUE-KEY> '.
    expect(msg.startsWith(`${ISSUE_KEY} resolve attempt`)).toBe(true);
  });

  it('agentMessage returns the clean subject and body for downstream PR formatting', async () => {
    await addCommit(wt, {
      file: 'a.txt',
      content: '1\n',
      message: `${ISSUE_KEY}: Fix bug\n\nDetails about the fix.\nSecond paragraph.`,
    });

    const result = await finalize({
      worktreePath: wt,
      baseRef,
      issueKey: ISSUE_KEY,
      attemptId: ATTEMPT_ID,
    });

    if (result.commits !== 1) throw new Error('expected commits=1');
    // stripIssueKeyPrefix removes the `RND-7:` prefix (note `:` and
    // trailing space).
    expect(result.agentMessage.subject).toBe('Fix bug');
    // Body comes from the agent's commit body (not the squashed
    // message, which would also include trailers).
    expect(result.agentMessage.body).toContain('Details about the fix.');
    expect(result.agentMessage.body).not.toContain('Resolve-Attempt:');
  });
});
