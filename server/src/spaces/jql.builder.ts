export type SpaceFilter = {
  jiraProject: string;
  filterField: 'component' | 'labels' | 'fixVersion';
  filterValue: string;
  allowedStatuses: string[];
  agentLabels: string[];
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

  return parts.join(' AND ');
}
