import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type LsRemoteResult = { ok: true } | { ok: false; error: string };

export type CommitMessage = { subject: string; body: string };

// Sets up a tempfile GIT_ASKPASS script and runs fn with the appropriate env.
// GitHub accepts the token as either the username or the password on HTTPS;
// the script returns `x-access-token` when git prompts for a username and the
// token otherwise. Token never lands in argv, the URL, or the reflog.
async function withGitAuth<T>(
  token: string,
  fn: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), 'git-askpass-'));
  const askpass = join(tmp, 'askpass.sh');
  writeFileSync(
    askpass,
    '#!/bin/sh\ncase "$1" in\n  *sername*) echo "x-access-token" ;;\n  *) echo "$GITHUB_TOKEN" ;;\nesac\n',
    { mode: 0o700 },
  );
  try {
    return await fn({
      ...process.env,
      GITHUB_TOKEN: token,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: '0',
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --------- read-only / local operations (no auth) -------------------------

async function gitLocal(
  cwd: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string } = {},
): Promise<string> {
  const child = execFile('git', ['-C', cwd, ...args], {
    timeout: opts.timeoutMs ?? 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (opts.input !== undefined && child.stdin) {
    child.stdin.end(opts.input);
  }
  const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: out });
      else reject(new Error(`git ${args.join(' ')} failed (${code}): ${err.trim()}`));
    });
  });
  return stdout;
}

// --------- ls-remote (with auth, no local repo needed) --------------------

export async function lsRemote(repoUrl: string, token: string): Promise<LsRemoteResult> {
  return withGitAuth(token, async (env) => {
    try {
      await execFileAsync('git', ['ls-remote', '--exit-code', repoUrl, 'HEAD'], {
        env,
        timeout: 15_000,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message.split('\n').slice(0, 3).join(' ').slice(0, 300) };
    }
  });
}

// --------- auth-needing clone / fetch -------------------------------------

export async function cloneRepo(args: {
  url: string;
  token: string;
  dest: string;
}): Promise<void> {
  await withGitAuth(args.token, async (env) => {
    await execFileAsync('git', ['clone', args.url, args.dest], {
      env,
      timeout: 5 * 60_000,
      maxBuffer: 50 * 1024 * 1024,
    });
  });
}

export async function fetchOrigin(repoDir: string, token: string): Promise<void> {
  await withGitAuth(token, async (env) => {
    await execFileAsync('git', ['-C', repoDir, 'fetch', '--prune', 'origin'], {
      env,
      timeout: 2 * 60_000,
      maxBuffer: 50 * 1024 * 1024,
    });
  });
}

// --------- local refs / worktree / commit ---------------------------------

// Does `refs/remotes/origin/<branchName>` exist in the local clone? Assumes
// the caller has just run `fetchOrigin`, so this is an accurate proxy for
// "does the branch exist on the remote".
export async function lsRemoteBranch(repoDir: string, branchName: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['-C', repoDir, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`],
      { timeout: 10_000 },
    );
    return true;
  } catch {
    return false;
  }
}

export async function worktreeAdd(args: {
  repoDir: string;
  wtPath: string;
  branchName: string;
  startPoint: string;
}): Promise<void> {
  // -B creates the local branch if missing OR resets it to startPoint. The
  // worktree is checked out on that branch.
  await execFileAsync(
    'git',
    ['-C', args.repoDir, 'worktree', 'add', '-B', args.branchName, args.wtPath, args.startPoint],
    { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
  );
}

export async function worktreeRemove(repoDir: string, wtPath: string): Promise<void> {
  // --force because the worktree may have uncommitted changes left by the
  // agent that we don't want to preserve (squash happened or failed).
  await execFileAsync(
    'git',
    ['-C', repoDir, 'worktree', 'remove', '--force', wtPath],
    { timeout: 30_000 },
  );
}

export async function revList(wtPath: string, base: string, head: string): Promise<string[]> {
  const out = await gitLocal(wtPath, ['rev-list', `${base}..${head}`]);
  return out.split('\n').filter(Boolean);
}

// Commits whatever's currently staged. Message read from stdin so newlines
// and trailers come through cleanly.
export async function commit(wtPath: string, message: string): Promise<void> {
  await gitLocal(wtPath, ['commit', '--allow-empty-message', '-F', '-'], { input: message });
}

export async function resetSoft(wtPath: string, ref: string): Promise<void> {
  await gitLocal(wtPath, ['reset', '--soft', ref]);
}

export async function headSubjectBody(wtPath: string): Promise<CommitMessage> {
  const subject = (await gitLocal(wtPath, ['log', '-1', '--pretty=format:%s'])).trim();
  const body = (await gitLocal(wtPath, ['log', '-1', '--pretty=format:%b'])).trim();
  return { subject, body };
}

export async function configUser(wtPath: string, name: string, email: string): Promise<void> {
  await gitLocal(wtPath, ['config', 'user.name', name]);
  await gitLocal(wtPath, ['config', 'user.email', email]);
}
