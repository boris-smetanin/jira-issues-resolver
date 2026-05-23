import { z } from 'zod';

// Slice 14: bounds match the migration's CHECK (1..365). Coerce so the
// UI can send a string from a <input type="number"> without ceremony.
export const updateLogRetentionDto = z.object({
  days: z.coerce.number().int().min(1).max(365),
});

export type UpdateLogRetentionDto = z.infer<typeof updateLogRetentionDto>;
