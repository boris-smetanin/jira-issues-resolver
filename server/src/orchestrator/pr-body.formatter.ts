import type { ResolveAttempt } from '@jir/shared';
import type { JiraIssue } from '../integrations/jira/jira.client.js';

export function formatPullRequestTitle(issue: JiraIssue): string {
  return `${issue.key} ${issue.summary}`.trim();
}

export type FormatPullRequestBodyArgs = {
  issue: JiraIssue;
  attempt: ResolveAttempt;
  jiraBaseUrl: string;
  // The agent's own commit subject + body (post-prefix-strip, pre-trailer).
  // This is the "what the agent actually did" text — the source of truth
  // for the PR body. The Jira description is *not* included verbatim; only
  // a link is kept in the metadata block for cross-reference.
  agentMessage: { subject: string; body: string };
};

// Markdown body shape:
//
//   <agent's commit body — the reasoning the agent wrote>
//
//   ---
//
//   <details><summary>Resolution metadata</summary>
//
//   - Jira: [<KEY>](<jira-link>)
//   - Resolve-Attempt: `<uuid>`
//   - Prior-Attempt: `<uuid>`   (only on reopens)
//
//   </details>
//
// Rationale: the agent's commit body explains WHAT changed and WHY in its
// own narrative — that's the most useful PR description for human reviewers.
// The original Jira description is one click away via the metadata link;
// duplicating it inline just bloats the PR.
export function formatPullRequestBody(args: FormatPullRequestBodyArgs): string {
  const jiraLink = `${args.jiraBaseUrl}/browse/${args.issue.key}`;
  const agentNarrative = args.agentMessage.body.trim() || '_(agent left no commit body)_';

  const lines: string[] = [
    agentNarrative,
    '',
    '---',
    '',
    '<details><summary>Resolution metadata</summary>',
    '',
    `- Jira: [${args.issue.key}](${jiraLink}) — ${args.issue.summary}`,
    `- Resolve-Attempt: \`${args.attempt.id}\``,
  ];
  if (args.attempt.priorAttemptId) {
    lines.push(`- Prior-Attempt: \`${args.attempt.priorAttemptId}\``);
  }
  lines.push('', '</details>');

  return lines.join('\n');
}
