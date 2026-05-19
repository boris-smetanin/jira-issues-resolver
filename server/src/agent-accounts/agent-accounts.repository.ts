import type { Selectable } from 'kysely';
import { decrypt, encrypt } from '../core/crypto.js';
import type { AgentAccountsTable } from '../core/db.js';
import { getDb } from '../core/db.js';
import type { AgentProvider } from '../integrations/agent-providers/registry.js';

type Row = Selectable<AgentAccountsTable>;

// Internal shape with decrypted key. Never serialise this directly — go
// through agent-accounts.service.ts's toPublic() to redact.
export type AgentAccount = {
  id: string;
  provider: AgentProvider;
  name: string;
  apiKey: string;
  createdAt: Date;
  updatedAt: Date;
};

function rowToAccount(row: Row): AgentAccount {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    apiKey: decrypt(row.api_key_enc),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function create(input: {
  provider: AgentProvider;
  name: string;
  apiKey: string;
}): Promise<AgentAccount> {
  const row = await getDb()
    .insertInto('agent_accounts')
    .values({
      provider: input.provider,
      name: input.name,
      api_key_enc: encrypt(input.apiKey),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return rowToAccount(row);
}

export async function findById(id: string): Promise<AgentAccount | null> {
  const row = await getDb()
    .selectFrom('agent_accounts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? rowToAccount(row) : null;
}

export async function list(): Promise<AgentAccount[]> {
  const rows = await getDb()
    .selectFrom('agent_accounts')
    .selectAll()
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map(rowToAccount);
}

export async function update(
  id: string,
  input: { name?: string; apiKey?: string },
): Promise<AgentAccount> {
  const row = await getDb()
    .updateTable('agent_accounts')
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.apiKey !== undefined ? { api_key_enc: encrypt(input.apiKey) } : {}),
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return rowToAccount(row);
}

export async function remove(id: string): Promise<void> {
  await getDb().deleteFrom('agent_accounts').where('id', '=', id).execute();
}

// Pre-flight for delete: lists active (non-soft-deleted) Spaces that
// reference this account. The FK is ON DELETE RESTRICT, so the DB would
// block anyway — but checking here lets us return a friendly message
// with the dependent Space names instead of a SQL error.
export async function listSpacesReferencing(
  accountId: string,
): Promise<Array<{ id: string; name: string }>> {
  return getDb()
    .selectFrom('spaces')
    .select(['id', 'name'])
    .where('agent_account_id', '=', accountId)
    .where('deleted_at', 'is', null)
    .execute();
}
