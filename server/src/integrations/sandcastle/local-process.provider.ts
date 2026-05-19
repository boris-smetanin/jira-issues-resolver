import { spawn } from 'node:child_process';
import { mkdir as fsMkdir, copyFile as fsCopyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import {
  createBindMountSandboxProvider,
  type BindMountCreateOptions,
  type BindMountSandboxHandle,
  type ExecResult,
} from '@ai-hero/sandcastle';

// Custom Sandcastle bind-mount provider that runs commands as SUBPROCESSES
// on the host — no Docker, no isolation. Sandcastle still drives the full
// lifecycle (worktree creation, branch strategy, commit extraction, stream
// events) but `exec` just spawns `sh -c <command>` in the worktree.
//
// Implementation notes (matched to SandboxProvider.ts contract):
//   - `options.stdin`: when present, pipe to the child's stdin and close.
//     Sandcastle relies on this for prompts >> 128 KB and for the claude
//     CLI's `-p -` (prompt-from-stdin) mode.
//   - `options.onLine`: must call line-by-line (not batched) so Sandcastle
//     can emit live stream events + enforce idle timeouts.
//   - `sandboxHomedir`: `/home/agent` matches Sandcastle's SessionPaths
//     hardcoded sandbox HOME — required for session capture to find files.
//
// Slice 11 introduces the `docker()` variant for the container Agent
// Runtime by swapping in Sandcastle's built-in provider.

export function localProcess(opts: { env: NodeJS.ProcessEnv }) {
  return createBindMountSandboxProvider({
    name: 'local-process',
    sandboxHomedir: '/home/agent',
    create: async (
      options: BindMountCreateOptions,
    ): Promise<BindMountSandboxHandle> => {
      const worktreePath = options.worktreePath;
      const baseEnv = { ...process.env, ...opts.env };

      return {
        worktreePath,

        exec: (
          command: string,
          execOpts?: {
            onLine?: (line: string) => void;
            cwd?: string;
            sudo?: boolean;
            stdin?: string;
          },
        ): Promise<ExecResult> => {
          return new Promise<ExecResult>((resolve, reject) => {
            const cwd = execOpts?.cwd ?? worktreePath;
            const hasStdin = execOpts?.stdin !== undefined;
            const proc = spawn('sh', ['-c', command], {
              cwd,
              env: baseEnv,
              stdio: [hasStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
            });

            if (hasStdin && proc.stdin) {
              proc.stdin.on('error', (err) => {
                // Child can exit before we finish writing (e.g. on short
                // prompts that hit completion immediately). EPIPE is
                // expected; ignore.
                if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
                  reject(err);
                }
              });
              proc.stdin.end(execOpts!.stdin);
            }

            const stdoutChunks: string[] = [];
            const stderrChunks: string[] = [];

            if (execOpts?.onLine) {
              const onLine = execOpts.onLine;
              const rl = createInterface({ input: proc.stdout! });
              rl.on('line', (line) => {
                stdoutChunks.push(line);
                onLine(line);
              });
            } else {
              proc.stdout!.on('data', (chunk: Buffer) => {
                stdoutChunks.push(chunk.toString());
              });
            }
            proc.stderr!.on('data', (chunk: Buffer) => {
              stderrChunks.push(chunk.toString());
            });

            proc.on('error', (err) => reject(err));
            proc.on('close', (code) => {
              const joiner = execOpts?.onLine ? '\n' : '';
              resolve({
                stdout: stdoutChunks.join(joiner),
                stderr: stderrChunks.join(''),
                exitCode: code ?? 0,
              });
            });
          });
        },

        copyFileIn: async (hostPath: string, sandboxPath: string) => {
          await fsMkdir(dirname(sandboxPath), { recursive: true });
          await fsCopyFile(hostPath, sandboxPath);
        },

        copyFileOut: async (sandboxPath: string, hostPath: string) => {
          await fsMkdir(dirname(hostPath), { recursive: true });
          await fsCopyFile(sandboxPath, hostPath);
        },

        close: async () => {
          // Nothing to tear down for a local process — the spawned children
          // have already exited by the time Sandcastle calls close.
        },
      };
    },
  });
}
