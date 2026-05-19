import { z } from 'zod';

const noNewlines = (msg: string): z.ZodEffects<z.ZodString, string, string> =>
  z
    .string()
    .trim()
    .min(1)
    .refine((s) => !/[\r\n]/.test(s), { message: msg });

export const createSpaceDto = z.object({
  name: z.string().trim().min(1),
  githubRepoUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('https://github.com/'), {
      message: 'GitHub repo URL must start with https://github.com/',
    }),
  githubToken: z.string().trim().min(1),
  githubCommitterName: z.string().trim().min(1),
  githubCommitterEmail: z.string().trim().email(),
  baseBranch: z.string().trim().min(1).default('main'),
  agentProvider: z.enum(['claude', 'codex']),
  agentModel: z.string().trim().min(1),
  jiraProject: z
    .string()
    .trim()
    .min(1)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Jira project key must be uppercase letters / digits / underscore'),
  filterField: z.enum(['component', 'labels', 'fixVersion']),
  filterValue: noNewlines('filterValue must not contain newlines'),
  allowedStatuses: z.array(noNewlines('allowedStatuses entries must not contain newlines')).min(1),
  agentLabels: z
    .array(noNewlines('agentLabels entries must not contain newlines'))
    .min(1)
    .default(['queued', 'reopen']),
  targetStatusName: noNewlines('targetStatusName must not contain newlines'),
  tickIntervalSeconds: z.number().int().min(30).max(3600).default(300),
});

export type CreateSpaceDto = z.infer<typeof createSpaceDto>;
