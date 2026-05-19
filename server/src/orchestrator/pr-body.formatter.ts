import type { ResolveAttempt } from '@jir/shared';
import { adfToMarkdown } from '../integrations/adf/adf.formatter.js';
import type { JiraIssue } from '../integrations/jira/jira.client.js';

export function formatPullRequestTitle(issue: JiraIssue): string {
  return `${issue.key} ${issue.summary}`.trim();
}

export type FormatPullRequestBodyArgs = {
  issue: JiraIssue;
  attempt: ResolveAttempt;
  jiraBaseUrl: string;
};

// Markdown body:
//   <issue description rendered from ADF>
//   ---
//   _Resolved by AI agent — [<KEY>](<jira-link>)_
//   <details><summary>Resolution metadata</summary>
//   - Resolve-Attempt: `<uuid>`
//   - Prior-Attempt: `<uuid>`   (only on reopens)
//   </details>
export function formatPullRequestBody(args: FormatPullRequestBodyArgs): string {
  const description = adfToMarkdown(args.issue.descriptionAdf) || '_(no description)_';
  const jiraLink = `${args.jiraBaseUrl}/browse/${args.issue.key}`;

  const lines: string[] = [
    description,
    '',
    '---',
    '',
    `_Resolved by AI agent — [${args.issue.key}](${jiraLink})_`,
    '',
    '<details><summary>Resolution metadata</summary>',
    '',
    `- Resolve-Attempt: \`${args.attempt.id}\``,
  ];
  if (args.attempt.priorAttemptId) {
    lines.push(`- Prior-Attempt: \`${args.attempt.priorAttemptId}\``);
  }
  lines.push('', '</details>');

  return lines.join('\n');
}
