import {
  AGENT_PROVIDERS,
  AgentValidateError,
  type AgentProvider,
} from '../integrations/agent-providers/registry.js';
import type { AgentAccount } from './agent-accounts.repository.js';
import * as repo from './agent-accounts.repository.js';

export class AccountValidationError extends Error {
  readonly field: string;
  readonly status: number;
  constructor(field: string, message: string, status = 400) {
    super(message);
    this.name = 'AccountValidationError';
    this.field = field;
    this.status = status;
  }
}

export type PublicAgentAccount = {
  id: string;
  provider: AgentProvider;
  name: string;
  redactedKey: string;
  createdAt: string;
  updatedAt: string;
};

function redact(key: string): string {
  if (key.length <= 4) return '••••';
  return '••••••••' + key.slice(-4);
}

function toPublic(a: AgentAccount): PublicAgentAccount {
  return {
    id: a.id,
    provider: a.provider,
    name: a.name,
    redactedKey: redact(a.apiKey),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export async function listAccounts(): Promise<PublicAgentAccount[]> {
  return (await repo.list()).map(toPublic);
}

export async function findAccountById(id: string): Promise<PublicAgentAccount | null> {
  const a = await repo.findById(id);
  return a ? toPublic(a) : null;
}

// Used by slice 5b's orchestrator — exposes the plaintext key.
export async function findInternalAccountById(id: string): Promise<AgentAccount | null> {
  return repo.findById(id);
}

async function validateForProvider(provider: AgentProvider, apiKey: string): Promise<void> {
  const config = AGENT_PROVIDERS[provider];
  if (!config) {
    throw new AccountValidationError('provider', `Unknown provider "${provider}"`);
  }
  if (!config.enabled) {
    throw new AccountValidationError('provider', `${config.label} is not enabled yet`);
  }
  const shapeRes = config.keyShape.safeParse(apiKey);
  if (!shapeRes.success) {
    throw new AccountValidationError(
      'apiKey',
      shapeRes.error.issues[0]?.message ?? 'invalid API key shape',
    );
  }
  try {
    await config.validate(apiKey);
  } catch (err) {
    if (err instanceof AgentValidateError) {
      throw new AccountValidationError('apiKey', err.message);
    }
    throw err;
  }
}

export async function createAccount(input: {
  provider: AgentProvider;
  name: string;
  apiKey: string;
}): Promise<PublicAgentAccount> {
  await validateForProvider(input.provider, input.apiKey);
  const created = await repo.create(input);
  return toPublic(created);
}

export async function updateAccount(
  id: string,
  input: { name?: string; apiKey?: string },
): Promise<PublicAgentAccount> {
  const existing = await repo.findById(id);
  if (!existing) {
    throw new AccountValidationError('id', 'Account not found', 404);
  }
  if (input.apiKey !== undefined) {
    // Re-validate the new key against the account's existing provider.
    await validateForProvider(existing.provider, input.apiKey);
  }
  const updated = await repo.update(id, input);
  return toPublic(updated);
}

export async function deleteAccount(id: string): Promise<void> {
  const refs = await repo.listSpacesReferencing(id);
  if (refs.length > 0) {
    const names = refs.map((s) => s.name).join(', ');
    throw new AccountValidationError(
      'id',
      `Cannot delete: ${refs.length} Space(s) reference this account (${names}). Reassign them first.`,
      409,
    );
  }
  await repo.remove(id);
}
