import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AttemptLogger } from '../logs/attempt-log.js';

// Slice 16b: orchestrator-driven dep install for code-improvement-shape
// attempts. Only this shape needs it — bug/feature attempts rely on
// read-based verification.
//
// Why orchestrator-side (option C') rather than agent-side (B'):
// - The agent stays clean of install machinery; it just sees a worktree
//   with deps present (or not) at startup.
// - Failure isolation: a private-registry auth error is caught and
//   surfaced once, not nested inside the agent's tool-call loop.
// - Caching: the package manager's content-addressable store (pnpm at
//   ~/.local/share/pnpm/store) is shared across worktrees on the host;
//   the per-attempt install is mostly resolution + symlinking.
//
// Constraints:
// - Postinstall scripts are disabled in every supported package manager
//   (--no-scripts / --ignore-scripts) for security. Static checking
//   doesn't need postinstall.
// - 5-minute timeout — bails to soft-fallback if install hangs.
// - Failure is soft: log + tell the agent in the prompt to fall back
//   to read-based verification. Never blocks the attempt.

const INSTALL_TIMEOUT_MS = 5 * 60_000;

export type LockfileKind = 'pnpm' | 'npm' | 'yarn' | 'poetry' | 'pip' | 'composer';

export type InstallCommand = {
  kind: LockfileKind;
  exe: string;
  args: string[];
};

export type InstallResult =
  | { kind: 'installed'; command: InstallCommand; durationMs: number }
  | { kind: 'no-lockfile' }
  | { kind: 'failed'; command: InstallCommand; reason: string; durationMs: number };

// Detect what to run based on lockfile presence. Returns null if the
// project doesn't have a recognised lockfile (Go / Rust / native-tooling
// projects — no install needed; static checks like `go vet` / `cargo
// check` are self-contained).
export function detectInstallCommand(worktreePath: string): InstallCommand | null {
  const exists = (rel: string): boolean => existsSync(join(worktreePath, rel));
  if (exists('pnpm-lock.yaml'))
    return { kind: 'pnpm', exe: 'pnpm', args: ['install', '--frozen-lockfile', '--ignore-scripts'] };
  if (exists('package-lock.json'))
    return { kind: 'npm', exe: 'npm', args: ['ci', '--ignore-scripts'] };
  if (exists('yarn.lock'))
    return {
      kind: 'yarn',
      exe: 'yarn',
      args: ['install', '--frozen-lockfile', '--ignore-scripts'],
    };
  if (exists('poetry.lock'))
    return { kind: 'poetry', exe: 'poetry', args: ['install', '--no-root'] };
  if (exists('requirements.txt'))
    return { kind: 'pip', exe: 'pip', args: ['install', '-r', 'requirements.txt'] };
  if (exists('composer.lock'))
    return { kind: 'composer', exe: 'composer', args: ['install', '--no-scripts'] };
  return null;
}

// Run the install. Captures stdout+stderr into the attempt's NDJSON log
// (via the AttemptLogger) under `src: 'install'`. Resolves with the
// outcome; never throws.
export async function runInstall(args: {
  worktreePath: string;
  command: InstallCommand;
  // Optional env vars to inject (e.g. NPM_REGISTRY_TOKEN for private
  // GitHub Packages). Merged with the inherited process.env at spawn.
  envOverrides: Record<string, string>;
  log: AttemptLogger;
}): Promise<InstallResult> {
  const { worktreePath, command, envOverrides, log } = args;
  const startedAt = Date.now();

  log.log('info', 'install', `running ${command.exe} ${command.args.join(' ')}`, {
    cwd: worktreePath,
    lockfile: command.kind,
  });

  return await new Promise<InstallResult>((resolve) => {
    const child = execFile(command.exe, command.args, {
      cwd: worktreePath,
      env: { ...process.env, ...envOverrides },
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Stream output into the attempt log. install commands can be
    // chatty — truncate per-line so we don't drown the NDJSON, but
    // keep enough context to debug auth/network failures.
    let stderrTail = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          log.log('info', 'install', trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed);
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000); // keep last 2K for failure reason
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          log.log('warn', 'install', trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed);
        }
      }
    });
    child.on('close', (code) => {
      const durationMs = Date.now() - startedAt;
      if (code === 0) {
        log.log('info', 'install', `install succeeded in ${(durationMs / 1000).toFixed(1)}s`);
        resolve({ kind: 'installed', command, durationMs });
      } else {
        const reason = `exit code ${code}${stderrTail ? `: ${stderrTail.trim().slice(0, 500)}` : ''}`;
        log.log('warn', 'install', `install FAILED (${reason})`, { durationMs });
        resolve({ kind: 'failed', command, reason, durationMs });
      }
    });
    child.on('error', (err) => {
      const durationMs = Date.now() - startedAt;
      const reason = err.message;
      log.log('warn', 'install', `install spawn error (${reason})`, { durationMs });
      resolve({ kind: 'failed', command, reason, durationMs });
    });
  });
}
