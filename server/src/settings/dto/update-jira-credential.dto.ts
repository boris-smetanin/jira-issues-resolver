import { z } from 'zod';

export const updateJiraCredentialDto = z.object({
  email: z.string().trim().email(),
  apiToken: z.string().trim().min(1),
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'baseUrl must use https://' })
    .transform((u) => u.replace(/\/+$/, '')),
});

export type UpdateJiraCredentialDto = z.infer<typeof updateJiraCredentialDto>;
