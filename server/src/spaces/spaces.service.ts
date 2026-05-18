import type { Space } from '@jir/shared';
import { getDb } from '../core/db.js';

export async function listSpaces(): Promise<Space[]> {
  const rows = await getDb().selectFrom('spaces').select(['id', 'name']).execute();
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
