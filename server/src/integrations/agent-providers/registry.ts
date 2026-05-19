import { z } from 'zod';

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

  /** Env var name the Sandcastle runner sets when launching the agent. */
  envVar: string;

  /** Models offered in the Space form's model dropdown. */
  models: string[];

  /** Cheap shape check applied at zod-time before any network call. */
  keyShape: z.ZodTypeAny;

  /** Live validation against the provider's API. Throws AgentValidateError. */
  validate(apiKey: string): Promise<AgentValidateInfo>;

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
    enabled: true,
  },
  codex: {
    label: 'OpenAI (Codex)',
    envVar: 'OPENAI_API_KEY',
    models: [],
    keyShape: z.string().trim().min(1),
    validate: async () => {
      throw new AgentValidateError('Codex support lands in slice 12', 501);
    },
    enabled: false,
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
