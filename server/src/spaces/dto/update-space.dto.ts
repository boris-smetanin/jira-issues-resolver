import { z } from 'zod';

// Slice 10 polish: editable subset of Space. Excluded by design:
// - id / createdAt / updatedAt — managed by the system.
// - githubRepoUrl — changing this would orphan the existing clone + worktrees.
// - githubToken — separate rotation flow later, not part of edit.
// - loopRunning — controlled by /loop/start /loop/stop, not a form field.
// - agentRuntimeMode / dockerfileContent — tied to slice 0011 (container mode).
//
// `tickIntervalSeconds`, `agentAccountId`, `agentModel` ARE here (per UX
// follow-up: one big Save for all settings, instead of inline controls
// scattered across the Space detail page).

const noNewlines = (msg: string): z.ZodEffects<z.ZodString, string, string> =>
  z
    .string()
    .trim()
    .min(1)
    .refine((s) => !/[\r\n]/.test(s), { message: msg });

export const updateSpaceDto = z.object({
  name: z.string().trim().min(1),
  baseBranch: z.string().trim().min(1),
  githubCommitterName: z.string().trim().min(1),
  githubCommitterEmail: z.string().trim().email(),
  agentAccountId: z.string().uuid(),
  agentModel: z.string().trim().min(1),
  tickIntervalSeconds: z.number().int().min(30).max(3600),
  jiraProject: z
    .string()
    .trim()
    .min(1)
    .regex(
      /^[A-Z][A-Z0-9_]*$/,
      'Jira project key must be uppercase letters / digits / underscore',
    ),
  filterField: z.enum(['component', 'labels', 'fixVersion']),
  filterValue: noNewlines('filterValue must not contain newlines'),
  allowedStatuses: z
    .array(noNewlines('allowedStatuses entries must not contain newlines'))
    .min(1),
  agentLabels: z
    .array(noNewlines('agentLabels entries must not contain newlines'))
    .min(1),
  targetStatusName: noNewlines('targetStatusName must not contain newlines'),
});

export type UpdateSpaceDto = z.infer<typeof updateSpaceDto>;
