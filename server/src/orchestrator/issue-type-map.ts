import type { IssueTypeMap, PromptShape } from '@jir/shared';

// Slice 16a: single source of truth for the issuetype → prompt-shape
// lookup. Drives BOTH the JQL filter (so the Resolve Loop only fetches
// recognised types) and the prompt dispatcher (so each attempt gets the
// right shape).
//
// Lookup is case-insensitive. JQL emits values with the natural casing
// from the configured lists; Jira's JQL is already case-insensitive for
// issuetype matching, so casing in the lists doesn't affect filter
// behaviour — only the lookup direction.

export function shapeFor(issuetype: string, map: IssueTypeMap): PromptShape | null {
  const needle = issuetype.trim().toLowerCase();
  if (map.bug.some((t) => t.toLowerCase() === needle)) return 'bug';
  if (map.codeImprovement.some((t) => t.toLowerCase() === needle)) return 'code-improvement';
  if (map.feature.some((t) => t.toLowerCase() === needle)) return 'feature';
  return null;
}

// Union of the three lists — drives `issuetype IN (…)` in JQL. Returns
// values with their stored casing (de-duplicated case-insensitively).
export function allKnownIssueTypes(map: IssueTypeMap): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...map.bug, ...map.codeImprovement, ...map.feature]) {
    const k = t.trim().toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t.trim());
    }
  }
  return out;
}
