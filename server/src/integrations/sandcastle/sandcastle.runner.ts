import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir as fsMkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { run, type AgentStreamEvent } from '@ai-hero/sandcastle';
import type { Space } from '@jir/shared';
import { findInternalAccountById } from '../../agent-accounts/agent-accounts.service.js';
import { commit as gitCommit } from '../git/git.client.js';
import { AGENT_PROVIDERS } from '../agent-providers/registry.js';
import { buildSpaceImage, createDockerProvider } from '../docker/docker-bind-mount.js';
import { localProcess } from './local-process.provider.js';

const execFileP = promisify(execFile);

export class AgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRunError';
  }
}

// Sandcastle's SessionPaths layer hardcodes the sandbox Claude projects
// dir at /home/agent/.claude/projects (see @ai-hero/sandcastle's
// SessionPaths.ts). For our localProcess provider host==sandbox, so we
// must point claude's HOME at that path or Sandcastle's session-capture
// step fails with ENOENT after the run.
//
// Cross-attempt isolation: session files inside this HOME are
// project-keyed by worktree path, so different attempts (different
// worktrees) get different session files. Shared HOME is safe.
const SHARED_AGENT_HOME = '/home/agent';

// Slice 12: Codex CLI requires ~/.codex/auth.json (written by `codex
// login --with-api-key`) to authenticate its WebSocket handshake to
// wss://api.openai.com/v1/responses. The OPENAI_API_KEY env var alone
// is detected by `codex doctor` but isn't sent on the WSS handshake,
// resulting in 401. This helper pipes the key on stdin to the login
// subcommand; ~10s budget covers slow disk on first run.
async function ensureCodexAuth(home: string, apiKey: string): Promise<void> {
  const child = execFile(
    'codex',
    ['login', '--with-api-key'],
    { env: { ...process.env, HOME: home }, timeout: 10_000 },
  );
  child.stdin?.end(apiKey);
  await new Promise<void>((resolve, reject) => {
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`codex login exited ${code}: ${stderr.trim()}`));
    });
  });
}

export type RunAgentArgs = {
  space: Space;
  attemptId: string;
  worktreePath: string;
  prompt: string;
  onEvent?: (event: AgentStreamEvent) => void;
  // Slice 15: orchestrator's per-attempt AbortController.signal. When
  // `requestStop` fires the controller, Sandcastle's `run` (and the
  // mock agent's setTimeout loop) cooperatively cancel.
  signal?: AbortSignal;
};

// Temporary dev scaffold. Set MOCK_AGENT=1 to bypass the real Claude/Codex
// run and instead write a note file + make a single commit. Lets slices
// 9-15 exercise the orchestrator state machine (push → PR → Jira transition,
// live logs, retention, reopen context) without burning real LLM tokens.
//
// Remove (or gate behind appConfig.env === 'dev') once issue #24 lands —
// that's the slice that actually exercises prompt/HITL/quality work and
// needs real agent runs.
async function runMockAgent(args: RunAgentArgs): Promise<void> {
  // Branch name == issue key, and worktree path is `…/wt/<issueKey>` (see
  // branch.resolver). basename() is sufficient and avoids threading
  // issueKey through RunAgentArgs just for the mock.
  const issueKey = basename(args.worktreePath);

  type StreamScript = Array<{ delayMs: number; build: () => AgentStreamEvent }>;
  const script: StreamScript = [
    {
      delayMs: 200,
      build: () =>
        ({
          type: 'text',
          message: `Analyzing ${issueKey}. Reading the issue description and acceptance criteria.`,
          iteration: 1,
          timestamp: new Date(),
        }) as unknown as AgentStreamEvent,
    },
    {
      delayMs: 400,
      build: () =>
        ({
          type: 'toolCall',
          name: 'Read',
          formattedArgs: 'src/index.ts',
          iteration: 1,
          timestamp: new Date(),
        }) as unknown as AgentStreamEvent,
    },
    {
      delayMs: 500,
      build: () =>
        ({
          type: 'text',
          message: 'Found the relevant handler. Drafting a minimal fix.',
          iteration: 2,
          timestamp: new Date(),
        }) as unknown as AgentStreamEvent,
    },
    {
      delayMs: 500,
      build: () =>
        ({
          type: 'toolCall',
          name: 'Edit',
          formattedArgs: 'mock-agent-note.md',
          iteration: 2,
          timestamp: new Date(),
        }) as unknown as AgentStreamEvent,
    },
    {
      delayMs: 400,
      build: () =>
        ({
          type: 'text',
          message: 'Verifying against tests.',
          iteration: 3,
          timestamp: new Date(),
        }) as unknown as AgentStreamEvent,
    },
    {
      delayMs: 400,
      build: () =>
        ({
          type: 'toolCall',
          name: 'Bash',
          formattedArgs: 'npm test',
          iteration: 3,
          timestamp: new Date(),
        }) as unknown as AgentStreamEvent,
    },
    {
      delayMs: 300,
      build: () =>
        ({
          type: 'text',
          message: 'All tests pass. Implementation complete.',
          iteration: 4,
          timestamp: new Date(),
        }) as unknown as AgentStreamEvent,
    },
  ];

  for (const step of script) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, step.delayMs);
      // Slice 15: a "stop attempt" mid-script should resolve the run
      // quickly, not finish playing the canned events. AbortError
      // bubbles up through runAgent → orchestrator's catch, which
      // converts it to FAILED + error_reason='stopped by user'.
      if (args.signal) {
        const onAbort = (): void => {
          clearTimeout(t);
          reject(new Error('aborted'));
        };
        if (args.signal.aborted) onAbort();
        else args.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
    args.onEvent?.(step.build());
  }

  // Always write to the same path so each attempt produces a real (small)
  // diff. The random UUID inside the body guarantees the diff is non-empty
  // even when re-running for the same issue.
  const notePath = join(args.worktreePath, 'mock-agent-note.md');
  const content = [
    '# Mock agent run',
    '',
    `- attempt: ${args.attemptId}`,
    `- issue: ${issueKey}`,
    `- timestamp: ${new Date().toISOString()}`,
    `- nonce: ${randomUUID()}`,
    '',
    'Generated by the MOCK_AGENT=1 scaffold. Unset MOCK_AGENT to run the real agent.',
    '',
  ].join('\n');
  // Slice 16b: alternate mock branch for smoke-testing the escalation
  // flow. MOCK_AGENT_ESCALATE=1 → write .jir/escalation.md + make zero
  // commits, so the orchestrator detects the file and routes to the
  // ESCALATED terminal.
  if (process.env.MOCK_AGENT_ESCALATE === '1') {
    const escalationDir = join(args.worktreePath, '.jir');
    await fsMkdir(escalationDir, { recursive: true });
    const escalationContent = [
      `# Mock escalation for ${issueKey}`,
      '',
      'This escalation was produced by `MOCK_AGENT_ESCALATE=1` for smoke-',
      'testing the slice 16b escalation flow without spending real LLM tokens.',
      '',
      '## Hypotheses investigated',
      '- Hypothesis 1: the cert-rotation step does not re-verify HTTPS.',
      '  Ruled out — needs a refactor across three modules to fix safely.',
      '',
      '## Case applies',
      'Case B — fix requires architectural changes too large for a single',
      'Jira-issue patch, and the only LOC-minimal alternative would',
      'violate the preservation rule.',
      '',
      '## Proposed refactor',
      'Introduce a separate verification stage between certificate',
      'upload and status-status flip. Specifics: ...',
      '',
      '(Generated by MOCK_AGENT_ESCALATE=1; this is not a real diagnosis.)',
      '',
    ].join('\n');
    await writeFile(join(escalationDir, 'escalation.md'), escalationContent);
    return; // intentionally no commit
  }

  await writeFile(notePath, content);
  await execFileP('git', ['-C', args.worktreePath, 'add', 'mock-agent-note.md']);

  // commit() in git.client uses --allow-empty-message + stdin so newlines
  // come through cleanly. The finalizer reads this subject/body via
  // headSubjectBody and squashes downstream, so the PR body formatter
  // ends up with this narrative.
  const subject = `Mock fix for ${issueKey}`;
  const body = [
    'MOCK_AGENT=1 — scaffolded commit to exercise the orchestrator end-to-end',
    'without invoking a real LLM. Replace with a real run by unsetting',
    'MOCK_AGENT.',
  ].join('\n');
  await gitCommit(args.worktreePath, `${subject}\n\n${body}`);
}

// Runs the Sandcastle agent inside the prepared worktree. Returns when the
// agent finishes (or errors). The caller (orchestrator) is responsible for
// looking at the resulting commits via git.revList and squashing.
export async function runAgent(args: RunAgentArgs): Promise<void> {
  if (process.env.MOCK_AGENT === '1') {
    return runMockAgent(args);
  }
  if (!args.space.agentAccountId) {
    throw new AgentRunError(
      'Space has no agent account assigned. Assign one in the Space detail page first.',
    );
  }
  const account = await findInternalAccountById(args.space.agentAccountId);
  if (!account) {
    throw new AgentRunError(
      `Agent account ${args.space.agentAccountId} not found (was it deleted?).`,
    );
  }
  const config = AGENT_PROVIDERS[account.provider];
  if (!config?.enabled || !config.sandcastleFactory) {
    throw new AgentRunError(
      `Provider "${account.provider}" is not enabled or has no Sandcastle factory wired.`,
    );
  }
  if (!config.models.includes(args.space.agentModel)) {
    throw new AgentRunError(
      `Model "${args.space.agentModel}" is not valid for ${config.label}.`,
    );
  }

  const home = SHARED_AGENT_HOME;
  await fsMkdir(home, { recursive: true });
  await fsMkdir(join(home, '.config'), { recursive: true });

  // Slice 12: Codex CLI's WebSocket wire format ignores OPENAI_API_KEY at
  // handshake time and reads credentials from ~/.codex/auth.json instead.
  // `codex login --with-api-key` materialises the env var into that file;
  // we re-run it on every attempt so a rotated key takes effect without
  // manual reset, and so two Codex accounts on different Spaces don't
  // race for the same auth.json.
  //
  // Slice 11: only do this for host mode. In container mode the agent
  // runs in a separate filesystem; writing auth.json on the server is
  // useless. The Docker provider handles the in-container login itself
  // via `codexApiKey` below.
  if (account.provider === 'codex' && args.space.agentRuntimeMode !== 'container') {
    await ensureCodexAuth(home, account.apiKey);
  }

  // Slice 11: dispatch by agent_runtime_mode. host uses the existing
  // localProcess provider; container builds + starts a Docker image
  // via the BindMount provider in integrations/docker. The agent
  // (claudeCode / codex) factory is the SAME for both — only the
  // sandbox differs.
  const sandbox = await buildSandbox({
    space: args.space,
    attemptId: args.attemptId,
    worktreePath: args.worktreePath,
    home,
    envVarName: config.envVar,
    apiKey: account.apiKey,
    provider: account.provider,
  });

  try {
    await run({
      agent: config.sandcastleFactory(args.space.agentModel),
      sandbox,
      cwd: args.worktreePath,
      prompt: args.prompt,
      // Slice 5's invariant: we own the worktree + branch, agent commits land
      // on whatever HEAD points at. branchStrategy: 'head' tells Sandcastle
      // not to manage branches itself.
      branchStrategy: { type: 'head' },
      // Slice 15: orchestrator passes its AbortController.signal here so
      // "stop attempt" cancels the in-flight Claude/Codex subprocess
      // without waiting for it to finish naturally (minutes).
      signal: args.signal,
      // Sandcastle's file logger captures full output to disk under the
      // per-attempt HOME. Slice 7 will replace this with the real NDJSON
      // writer; for now the onAgentStreamEvent callback is a noop or the
      // caller's hook.
      logging: {
        type: 'file',
        path: join(home, 'sandcastle.log'),
        onAgentStreamEvent: args.onEvent ?? (() => {}),
      },
    });
  } catch (err) {
    throw new AgentRunError(
      err instanceof Error ? err.message : String(err),
    );
  }
}

// Slice 11: pick the sandbox provider based on the Space's
// agent_runtime_mode. Host mode uses Sandcastle's noSandbox /
// localProcess (the agent shells out as a subprocess on the host).
// Container mode builds a per-Space Docker image (cached by tag),
// starts a container with the worktree bind-mounted via the shared
// `jir-data` named volume, and returns a BindMount provider that
// docker-execs commands into the container.
async function buildSandbox(args: {
  space: Space;
  attemptId: string;
  worktreePath: string;
  home: string;
  envVarName: string;
  apiKey: string;
  provider: string;
}) {
  if (args.space.agentRuntimeMode === 'container') {
    if (!args.space.dockerfileContent) {
      throw new AgentRunError(
        'Space is in container mode but no Dockerfile is saved. ' +
          'Open Edit Space → Container isolation → Detect from repo → Save.',
      );
    }
    // Build the per-Space image. Build context = worktree (Docker's
    // layer cache absorbs unchanged-Dockerfile rebuilds — typical
    // second-run cost: a few seconds).
    const imageTag = await buildSpaceImage({
      spaceId: args.space.id,
      worktreePath: args.worktreePath,
      dockerfileContent: args.space.dockerfileContent,
    });
    return createDockerProvider({
      spaceId: args.space.id,
      attemptId: args.attemptId,
      imageTag,
      containerName: `jir-attempt-${args.attemptId}`,
      // Slice 12: codex's WSS handshake requires ~/.codex/auth.json
      // inside the agent's HOME. For container mode, the provider
      // runs `codex login --with-api-key` inside the agent container
      // after `docker run`. Other providers don't need this.
      ...(args.provider === 'codex' ? { codexApiKey: args.apiKey } : {}),
    });
  }
  return localProcess({
    env: {
      [args.envVarName]: args.apiKey,
      HOME: args.home,
    },
  });
}
