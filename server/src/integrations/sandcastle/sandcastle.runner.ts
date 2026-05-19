import { mkdir as fsMkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { run, type AgentStreamEvent } from '@ai-hero/sandcastle';
import type { Space } from '@jir/shared';
import { findInternalAccountById } from '../../agent-accounts/agent-accounts.service.js';
import { AGENT_PROVIDERS } from '../agent-providers/registry.js';
import { localProcess } from './local-process.provider.js';

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

export type RunAgentArgs = {
  space: Space;
  attemptId: string;
  worktreePath: string;
  prompt: string;
  onEvent?: (event: AgentStreamEvent) => void;
};

// Runs the Sandcastle agent inside the prepared worktree. Returns when the
// agent finishes (or errors). The caller (orchestrator) is responsible for
// looking at the resulting commits via git.revList and squashing.
export async function runAgent(args: RunAgentArgs): Promise<void> {
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

  try {
    await run({
      agent: config.sandcastleFactory(args.space.agentModel),
      sandbox: localProcess({
        env: {
          [config.envVar]: account.apiKey,
          HOME: home,
        },
      }),
      cwd: args.worktreePath,
      prompt: args.prompt,
      // Slice 5's invariant: we own the worktree + branch, agent commits land
      // on whatever HEAD points at. branchStrategy: 'head' tells Sandcastle
      // not to manage branches itself.
      branchStrategy: { type: 'head' },
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
