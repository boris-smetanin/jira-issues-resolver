import { claudeCode, codex } from '@ai-hero/sandcastle';
import { z } from 'zod';

// One Sandcastle agent factory per provider. The runner picks the right
// factory by space's agent account's provider field and invokes it with
// the Space's chosen model string.
export type AgentFactory = (model: string) => ReturnType<typeof claudeCode>;

// Single source of truth for every agent provider this app knows about.
// Adding a provider = adding one entry here. Adding/changing fields here
// flows to: settings persistence, validation, UI dropdowns, orchestrator
// runner. No code outside this file should reference a provider string
// directly.

export type AgentProvider = 'claude' | 'codex';

export class AgentValidateError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AgentValidateError';
    this.status = status;
  }
}

export type AgentValidateInfo = { models?: string[] };

export type AgentProviderConfig = {
  /** Human-friendly label for UI rendering. */
  label: string;

  /**
   * Subprocess env-var name: what the agent CLI/SDK expects to read its API
   * key from at runtime. The runner sets this in the spawned subprocess's
   * env (NOT our process's env) when launching the agent. Decoupled from
   * how we *store* the key — that's the encrypted column in agent_accounts.
   */
  envVar: string;

  /** Models offered in the Space form's model dropdown. */
  models: string[];

  /** Cheap shape check applied at zod-time before any network call. */
  keyShape: z.ZodTypeAny;

  /** Live validation against the provider's API. Throws AgentValidateError. */
  validate(apiKey: string): Promise<AgentValidateInfo>;

  /**
   * Sandcastle agent factory for this provider. Null until the provider's
   * Sandcastle support lands (Codex → slice 12).
   */
  sandcastleFactory: AgentFactory | null;

  /** Disabled providers render but don't accept new credentials. */
  enabled: boolean;
};

async function validateAnthropic(apiKey: string): Promise<AgentValidateInfo> {
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
  } catch (err) {
    throw new AgentValidateError(
      `Could not reach Anthropic API: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AgentValidateError(
      `Anthropic /v1/models returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return { models: data.data?.map((m) => m.id) ?? [] };
}

// Slice 12: same shape as the Anthropic check but against OpenAI's
// /v1/models. Bearer auth instead of x-api-key. Returns the full list of
// model IDs the key can access — we don't use it to gate the dropdown
// (the dropdown shows our hand-picked subset), but it's useful for debug.
async function validateOpenAI(apiKey: string): Promise<AgentValidateInfo> {
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    throw new AgentValidateError(
      `Could not reach OpenAI API: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AgentValidateError(
      `OpenAI /v1/models returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return { models: data.data?.map((m) => m.id) ?? [] };
}

export const AGENT_PROVIDERS: Record<AgentProvider, AgentProviderConfig> = {
  claude: {
    label: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    keyShape: z
      .string()
      .trim()
      .min(20)
      .regex(/^sk-ant-/, 'Anthropic API keys start with "sk-ant-"'),
    validate: validateAnthropic,
    sandcastleFactory: claudeCode,
    enabled: true,
  },
  codex: {
    label: 'OpenAI (Codex)',
    envVar: 'OPENAI_API_KEY',
    // Picked from the Sandcastle README's `codex("gpt-5.4-mini")` example
    // plus the higher-effort gpt-5.4 sibling. The Codex CLI accepts any
    // OpenAI model ID — these are the recommended pair for v1. If a user
    // wants a different ID later we can extend this list without code
    // outside the registry.
    models: ['gpt-5.4', 'gpt-5.4-mini'],
    // Modern OpenAI keys start with `sk-` (project-scoped variants start
    // with `sk-proj-`). Permissive — final auth check is the live
    // /v1/models call below.
    keyShape: z.string().trim().min(20).regex(/^sk-/, 'OpenAI API keys start with "sk-"'),
    validate: validateOpenAI,
    sandcastleFactory: codex,
    enabled: true,
  },
};

export function getProviderConfig(provider: AgentProvider): AgentProviderConfig {
  return AGENT_PROVIDERS[provider];
}

export type ProviderPublicInfo = {
  id: AgentProvider;
  label: string;
  models: string[];
  enabled: boolean;
};

export function listProviders(): ProviderPublicInfo[] {
  return (Object.keys(AGENT_PROVIDERS) as AgentProvider[]).map((id) => ({
    id,
    label: AGENT_PROVIDERS[id].label,
    models: AGENT_PROVIDERS[id].models,
    enabled: AGENT_PROVIDERS[id].enabled,
  }));
}
