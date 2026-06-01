import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir as fsMkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, dirname } from 'node:path';
import {
  createBindMountSandboxProvider,
  type BindMountSandboxHandle,
  type BindMountSandboxProvider,
} from '@ai-hero/sandcastle';

// Slice 11: real Docker provider for Sandcastle's bind-mount sandbox
// contract. The provider:
//   - Writes the Space's Dockerfile to `<worktree>/.sandcastle/Dockerfile`.
//   - Builds (or reuses) a per-Space image tagged
//     `jir-space-<spaceId>:latest`. Docker's layer cache makes
//     unchanged-Dockerfile builds fast (seconds).
//   - Starts a container that bind-mounts the named volume `jir-data`
//     so the worktree path is identical inside both the server
//     container and the agent container.
//   - Returns a handle that `docker exec`s commands into the
//     container, streaming stdout/stderr line-by-line into
//     Sandcastle's `onLine` callback.
//
// Docker daemon is reached via the socket mounted by docker-compose
// (slice 8 added that). docker CLI is installed by the resolver image
// (slice 11 added that).
//
// Container lifecycle: created in `provider.create()` (called by
// Sandcastle once per agent run), torn down in `handle.close()`. One
// container per attempt; no reuse across attempts.

const DOCKER = 'docker';
const CONTAINER_INTERNAL_HOME = '/home/agent';

// Slice 11: resolve the real Docker volume name backing `/data` inside
// THIS (server) container, lazily and once. The compose file declares
// the volume as `jir-data`, but Compose project-prefixes named volumes
// so the actual name on the daemon is e.g. `<project>_jir-data` —
// hard-coding `jir-data` would mount a different (empty) volume into
// the agent container, leaving the worktree path invisible inside.
//
// We ask the daemon directly: `docker inspect $(hostname)` returns
// the current container's spec including the Mounts array, where the
// /data mount's `Name` is the project-prefixed volume name.
//
// `hostname()` works whether docker-compose sets a `container_name`
// (then hostname == that name) or not (then hostname == short
// container id, which is also a valid `docker inspect` target).
let resolvedDataVolume: Promise<string> | null = null;
async function getDataVolumeName(): Promise<string> {
  if (resolvedDataVolume) return resolvedDataVolume;
  resolvedDataVolume = (async () => {
    const self = hostname();
    const r = await runDocker([
      'inspect',
      self,
      '--format',
      '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}',
    ]);
    const name = r.stdout.trim();
    if (r.exitCode === 0 && name.length > 0) return name;
    throw new Error(
      `Could not resolve the Docker volume backing /data in this container ` +
        `(hostname=${self}, docker inspect exit=${r.exitCode}, ` +
        `stderr=${r.stderr.trim().slice(-300)}). Is the server container ` +
        `mounting a named volume at /data? Check docker-compose.yml.`,
    );
  })();
  return resolvedDataVolume;
}

// Wrapper around child_process.spawn that streams stdout/stderr
// line-by-line into a callback. Used by both `exec` and the
// image-build / container-start helpers.
type RunResult = { exitCode: number; stdout: string; stderr: string };
type RunOptions = {
  onLine?: (line: string) => void;
  stdin?: string;
  // When unset, child inherits the parent's stdio for piping.
};

function runDocker(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(DOCKER, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let stdoutBuf = '';
    let stderrBuf = '';

    function flushLines(buf: string, into: 'stdout' | 'stderr'): string {
      const lines = buf.split('\n');
      const remainder = lines.pop() ?? '';
      for (const line of lines) {
        const text = line.replace(/\r$/, '');
        if (into === 'stdout') stdout += `${text}\n`;
        else stderr += `${text}\n`;
        if (opts.onLine && text.length > 0) opts.onLine(text);
      }
      return remainder;
    }

    child.stdout?.on('data', (c: Buffer) => {
      stdoutBuf += c.toString('utf8');
      stdoutBuf = flushLines(stdoutBuf, 'stdout');
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderrBuf += c.toString('utf8');
      stderrBuf = flushLines(stderrBuf, 'stderr');
    });

    if (opts.stdin !== undefined) {
      child.stdin?.end(opts.stdin);
    } else {
      child.stdin?.end();
    }

    child.on('error', reject);
    child.on('close', (code) => {
      // Flush trailing partial lines without a newline.
      if (stdoutBuf) {
        stdout += stdoutBuf;
        if (opts.onLine) opts.onLine(stdoutBuf);
      }
      if (stderrBuf) {
        stderr += stderrBuf;
        if (opts.onLine) opts.onLine(stderrBuf);
      }
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// Image build
// ─────────────────────────────────────────────────────────────────────

export type BuildImageArgs = {
  spaceId: string;
  worktreePath: string; // build context lives under here
  dockerfileContent: string;
  onLine?: (line: string) => void;
};

// Builds (or rebuilds, leveraging layer cache) the per-Space image.
// Returns the image tag. `<worktree>/.sandcastle/Dockerfile` is the
// canonical location per the slice spec — keeps everything for the
// agent's container under one path, simple to gitignore.
//
// Docker-from-docker gotcha: we run inside the server container,
// docker daemon runs on the host. Paths like `/data/repos/...` are
// the server's view — the daemon doesn't see them as host paths. So
// instead of `docker build <path-context>` we tar the worktree and
// stream it to `docker build -` via stdin. The daemon reads the
// context bytes from us; no host-path translation needed. `-f` with
// stdin context interprets the path relative to the streamed
// context's root.
export async function buildSpaceImage(args: BuildImageArgs): Promise<string> {
  const tag = `jir-space-${args.spaceId}:latest`;
  const sandcastleDir = join(args.worktreePath, '.sandcastle');
  await fsMkdir(sandcastleDir, { recursive: true });
  const dockerfilePath = join(sandcastleDir, 'Dockerfile');
  await writeFile(dockerfilePath, args.dockerfileContent);

  return new Promise<string>((resolve, reject) => {
    const tar = spawn('tar', ['-cf', '-', '-C', args.worktreePath, '.'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const docker = spawn(
      DOCKER,
      ['build', '-t', tag, '-f', '.sandcastle/Dockerfile', '-'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let stderrTail = '';
    let stdoutBuf = '';
    let stderrBuf = '';

    function flush(buf: string, into: 'stdout' | 'stderr'): string {
      const lines = buf.split('\n');
      const remainder = lines.pop() ?? '';
      for (const line of lines) {
        const text = line.replace(/\r$/, '');
        if (into === 'stderr') stderrTail = (stderrTail + `${text}\n`).slice(-2000);
        if (args.onLine && text.length > 0) args.onLine(text);
      }
      return remainder;
    }

    tar.stdout.pipe(docker.stdin);
    // EPIPE-safety: when `docker build` exits before tar finishes
    // streaming (a build failure on an early layer is the common
    // case), the next tar.stdout write hits a closed pipe and emits
    // an `error` event on the socket. Without a listener, Node
    // promotes it to an unhandled `error` and crashes the
    // orchestrator. We swallow it on both ends and let the docker
    // exit code below be the source of truth.
    tar.stdout.on('error', () => undefined);
    docker.stdin?.on('error', () => undefined);

    tar.stderr.on('data', (c: Buffer) => {
      stderrBuf += c.toString('utf8');
      stderrBuf = flush(stderrBuf, 'stderr');
    });
    docker.stdout?.on('data', (c: Buffer) => {
      stdoutBuf += c.toString('utf8');
      stdoutBuf = flush(stdoutBuf, 'stdout');
    });
    docker.stderr?.on('data', (c: Buffer) => {
      stderrBuf += c.toString('utf8');
      stderrBuf = flush(stderrBuf, 'stderr');
    });

    // Tar failing to spawn (ENOENT) or dying for non-EPIPE reasons
    // is fatal; ignore the EPIPE that follows docker's early exit.
    tar.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') reject(err);
    });
    docker.on('error', reject);
    docker.on('close', (code) => {
      // If tar is still running (because docker exited first), stop
      // it so we don't leak the process.
      if (tar.exitCode === null && !tar.killed) tar.kill('SIGTERM');
      if (stdoutBuf && args.onLine) args.onLine(stdoutBuf);
      if (stderrBuf && args.onLine) args.onLine(stderrBuf);
      if (code === 0) resolve(tag);
      else reject(
        new Error(
          `docker build failed (exit ${code}): ${stderrTail.trim().slice(-1000)}`,
        ),
      );
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// Provider factory
// ─────────────────────────────────────────────────────────────────────

export type CreateDockerProviderArgs = {
  spaceId: string;
  attemptId: string;
  imageTag: string;
  // Container name — orchestrator picks this, typically
  // `jir-attempt-<attemptId>`. Unique per attempt to avoid name
  // collisions across in-flight runs.
  containerName: string;
  // Slice 11+12: codex's WSS handshake doesn't honor OPENAI_API_KEY
  // env alone — it reads ~/.codex/auth.json. For host mode,
  // sandcastle.runner.ts's ensureCodexAuth handles this on the
  // server. For container mode, we have to do the same login
  // *inside* the agent container so auth.json materializes in the
  // right filesystem. Caller passes the apiKey when the Space uses
  // the codex provider; otherwise omit.
  codexApiKey?: string;
  // Provider API key injected as an env var into the agent container
  // (e.g. ANTHROPIC_API_KEY). Sandcastle's env-merge pipeline only
  // carries vars from the repo's .env files and the provider/sandbox
  // `env` objects; the orchestrator holds the decrypted key and must
  // pass it here explicitly for container mode.
  apiKeyEnv?: Record<string, string>;
};

export function createDockerProvider(
  args: CreateDockerProviderArgs,
): BindMountSandboxProvider {
  return createBindMountSandboxProvider({
    name: 'docker',
    sandboxHomedir: CONTAINER_INTERNAL_HOME,
    create: async (opts): Promise<BindMountSandboxHandle> => {
      // Worktree path inside the container = worktree path on the host
      // (jir-data named volume mounted at /data in both server and
      // agent containers). No path translation needed.
      const worktreePath = opts.worktreePath;

      // Build the `docker run -d` argv. Detach so we can exec into it
      // repeatedly; remove on exit so we don't accumulate dead
      // containers if the orchestrator crashes between create() and
      // close().
      const dataVolume = await getDataVolumeName();
      const runArgs: string[] = [
        'run',
        '-d',
        '--rm',
        '--name',
        args.containerName,
        '-v',
        `${dataVolume}:/data`,
      ];
      for (const m of opts.mounts) {
        // Skip mounts already covered by the jir-data named volume.
        // Both the server container and the agent container mount
        // jir-data at /data, so paths under /data are accessible
        // byte-identically on both sides without any extra bind
        // mount. Forwarding them as `-v <serverPath>:<agentPath>`
        // fails because <serverPath> is the server container's view
        // (e.g. `/data/repos/...`) — the host docker daemon doesn't
        // know that path. Any non-/data mount (Sandcastle session
        // store, .npmrc, etc.) still goes through.
        if (m.hostPath.startsWith('/data/')) continue;
        runArgs.push('-v', `${m.hostPath}:${m.sandboxPath}${m.readonly ? ':ro' : ''}`);
      }
      for (const [k, v] of Object.entries(opts.env)) {
        // Slice 11: never let Sandcastle's host-side env stomp on
        // PATH inside the agent container. The image already pins a
        // sane PATH via the agent layer's ENV PATH=...; forwarding a
        // host PATH (which may point at server-container-only binaries
        // like /app/node_modules/.bin) breaks `sh -c 'git ...'` with
        // exit 127 inside the container.
        if (k === 'PATH') continue;
        runArgs.push('-e', `${k}=${v}`);
      }
      for (const [k, v] of Object.entries(args.apiKeyEnv ?? {})) {
        runArgs.push('-e', `${k}=${v}`);
      }
      runArgs.push(args.imageTag);

      const runResult = await runDocker(runArgs);
      if (runResult.exitCode !== 0) {
        throw new Error(
          `docker run failed (exit ${runResult.exitCode}): ${runResult.stderr.trim().slice(-500)}`,
        );
      }

      // Slice 11+12: codex auth has to happen *inside* this
      // container, against the agent user's HOME, so codex's WSS
      // handshake finds ~/.codex/auth.json. Mirrors the server-side
      // ensureCodexAuth used for host mode. Skip when not codex.
      if (args.codexApiKey) {
        const loginResult = await runDocker(
          [
            'exec',
            '-i',
            '-e', 'HOME=/home/agent',
            '--user', 'agent',
            args.containerName,
            'codex', 'login', '--with-api-key',
          ],
          { stdin: args.codexApiKey },
        );
        if (loginResult.exitCode !== 0) {
          // Don't leak the container if auth fails.
          await runDocker(['rm', '-f', args.containerName]).catch(() => undefined);
          throw new Error(
            `codex login (inside container) failed (exit ${loginResult.exitCode}): ${loginResult.stderr.trim().slice(-500)}`,
          );
        }
      }

      return {
        worktreePath,

        async exec(command, execOpts) {
          // Shell out via `sh -c` so multi-word commands and pipes work
          // (same convention as Sandcastle's localProcess provider).
          const execArgs: string[] = ['exec'];
          if (execOpts?.stdin !== undefined) execArgs.push('-i');
          if (execOpts?.cwd) {
            execArgs.push('--workdir', execOpts.cwd);
          }
          if (execOpts?.sudo) {
            execArgs.push('--user', 'root');
          }
          execArgs.push(args.containerName, 'sh', '-c', command);

          const r = await runDocker(execArgs, {
            ...(execOpts?.onLine ? { onLine: execOpts.onLine } : {}),
            ...(execOpts?.stdin !== undefined ? { stdin: execOpts.stdin } : {}),
          });
          return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
        },

        async copyFileIn(hostPath, sandboxPath) {
          // For files inside the named volume, the path is identical
          // on both sides — no docker cp needed. For files outside
          // the volume, we fall back to `docker cp host:container`.
          if (hostPath.startsWith('/data/')) {
            // Same volume, just copy on the host (writes through to
            // the volume which is visible inside the container).
            await fsMkdir(dirname(sandboxPath), { recursive: true });
            await copyFile(hostPath, sandboxPath);
            return;
          }
          const r = await runDocker([
            'cp',
            hostPath,
            `${args.containerName}:${sandboxPath}`,
          ]);
          if (r.exitCode !== 0) {
            throw new Error(`docker cp into container failed: ${r.stderr.trim().slice(-300)}`);
          }
        },

        async copyFileOut(sandboxPath, hostPath) {
          // Same trick: if the path is inside the named volume, copy
          // on the host directly.
          if (sandboxPath.startsWith('/data/') && hostPath.startsWith('/data/')) {
            await fsMkdir(dirname(hostPath), { recursive: true });
            // Use the file system since the volume is shared.
            const content = await readFile(sandboxPath);
            await writeFile(hostPath, content);
            return;
          }
          await fsMkdir(dirname(hostPath), { recursive: true });
          const r = await runDocker([
            'cp',
            `${args.containerName}:${sandboxPath}`,
            hostPath,
          ]);
          if (r.exitCode !== 0) {
            throw new Error(`docker cp out of container failed: ${r.stderr.trim().slice(-300)}`);
          }
        },

        async close() {
          // `--rm` on docker run means the container removes itself
          // after stopping. We stop it explicitly; the rm follows.
          // Ignore exit code — the container may already be gone if
          // it died earlier for whatever reason.
          await runDocker(['rm', '-f', args.containerName]).catch(() => undefined);
        },
      };
    },
  });
}
