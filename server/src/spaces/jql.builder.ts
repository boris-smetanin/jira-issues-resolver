export type SpaceFilter = {
  jiraProject: string;
  filterField: 'component' | 'labels' | 'fixVersion';
  filterValue: string;
  allowedStatuses: string[];
  agentLabels: string[];
  // Slice 16a: the union of all three issue-type lists in the issue-type
  // map. The resolver only fetches issues whose type is recognised — so
  // the prompt dispatcher never has to deal with unknown types at runtime.
  knownIssueTypes: string[];
};

// JQL string literal: wrap in double quotes, escape `\` and `"` inside.
// Prevents JQL injection from user-supplied filter values.
function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildJql(filter: SpaceFilter): string {
  const parts: string[] = [`project = ${quote(filter.jiraProject)}`];

  // When filter_field is 'labels', the value clause becomes another `labels =`;
  // Jira combines it with the agent-labels `IN` clause as expected.
  parts.push(`${filter.filterField} = ${quote(filter.filterValue)}`);

  if (filter.allowedStatuses.length > 0) {
    parts.push(`status in (${filter.allowedStatuses.map(quote).join(', ')})`);
  }
  if (filter.agentLabels.length > 0) {
    parts.push(`labels in (${filter.agentLabels.map(quote).join(', ')})`);
  }

  // Slice 16a: only fetch issues whose type maps to a known prompt shape.
  // If the union is empty (a misconfigured Space), skip the clause — the
  // settings UI validates against this, but be defensive.
  if (filter.knownIssueTypes.length > 0) {
    parts.push(`issuetype in (${filter.knownIssueTypes.map(quote).join(', ')})`);
  }

  // Slice 16a: exclude issues that the agent has already escalated. The
  // `agent-escalated` label is added by 16b's escalation handler; the
  // developer removes it manually after addressing the comment, at which
  // point the issue becomes eligible again.
  parts.push(`labels != "agent-escalated"`);

  return parts.join(' AND ');
}
