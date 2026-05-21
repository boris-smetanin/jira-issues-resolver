import { z } from 'zod';

// Slice 16a: validation for the issue-type → prompt-shape map update.
// Each list must have ≥1 entry — an empty list would silently disable a
// whole prompt shape (because the JQL filter excludes every issue of that
// type), which is almost certainly a misconfiguration.
//
// Entries are trimmed strings, no newlines, no empty values inside.

function issueTypeList(label: string) {
  return z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .refine((s) => !/[\r\n]/.test(s), {
          message: `${label} entries must not contain newlines`,
        }),
    )
    .min(1, `${label} must have at least one entry`);
}

export const updateIssueTypeMapDto = z.object({
  bug: issueTypeList('bug'),
  codeImprovement: issueTypeList('codeImprovement'),
  feature: issueTypeList('feature'),
});

export type UpdateIssueTypeMapDto = z.infer<typeof updateIssueTypeMapDto>;
