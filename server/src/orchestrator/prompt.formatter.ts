import { adfToMarkdown } from '../integrations/adf/adf.formatter.js';
import type { PRComment } from '../integrations/github/github.client.js';
import type { JiraComment, JiraIssue } from '../integrations/jira/jira.client.js';

// Slice 9 reopen context. When a Resolve Attempt has a non-null
// priorAttemptId, the orchestrator fetches PR review comments + Jira
// comments added after the prior attempt's ended_at, and the prompt
// builder folds them into a "this was previously attempted" block so the
// agent can address reviewer feedback in this run.
export type PriorAttemptContext = {
  endedAt: string | null;
  prUrl: string | null;
  prComments: PRComment[];
  jiraCommentsSince: JiraComment[];
};

export type BuildPromptArgs = {
  issue: JiraIssue;
  comments: JiraComment[];
  prior?: PriorAttemptContext;
};

const COMPLETION_SIGNAL = '<promise>COMPLETE</promise>';

// PR review threads can grow to dozens or hundreds of comments on busy
// repos; keep the prompt bounded so reopen-heavy issues don't blow the
// agent's context window. Tuned for "enough to address the latest review"
// rather than "complete audit trail".
const MAX_PR_COMMENTS_IN_PROMPT = 30;

export function buildPrompt(args: BuildPromptArgs): string {
  const { issue, comments, prior } = args;
  const parts: string[] = [];

  parts.push(`# Jira issue ${issue.key} — ${issue.summary}`);
  parts.push('');
  parts.push(`Status: ${issue.status || '(unknown)'}`);
  parts.push('');
  parts.push('## Description');
  parts.push('');
  parts.push(adfToMarkdown(issue.descriptionAdf) || '_(no description)_');

  if (comments.length > 0) {
    parts.push('');
    parts.push('## Comments');
    for (const c of comments) {
      parts.push('');
      parts.push(`### ${c.author} — ${c.createdAt}`);
      parts.push('');
      parts.push(adfToMarkdown(c.bodyAdf) || '_(empty comment)_');
    }
  }

  if (prior) {
    parts.push('');
    parts.push('---');
    parts.push('');
    parts.push('## This Jira issue was previously attempted');
    if (prior.prUrl) {
      parts.push('');
      parts.push(`Prior PR: ${prior.prUrl}`);
    }

    // Most-recent PR comments first — that's the feedback the agent most
    // needs to action.
    const prComments = [...prior.prComments]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, MAX_PR_COMMENTS_IN_PROMPT);
    if (prComments.length > 0) {
      parts.push('');
      parts.push('### Review feedback on the prior PR (most recent first)');
      const truncated = prior.prComments.length > prComments.length;
      if (truncated) {
        parts.push('');
        parts.push(
          `_Showing ${prComments.length} of ${prior.prComments.length} comments. Older ones omitted._`,
        );
      }
      for (const c of prComments) {
        parts.push('');
        const loc = c.path ? ` on \`${c.path}\`${c.line ? `:${c.line}` : ''}` : '';
        parts.push(`#### ${c.user} — ${c.ts}${loc}`);
        parts.push('');
        parts.push(c.body.trim() || '_(empty comment)_');
      }
    } else if (prior.prUrl) {
      parts.push('');
      parts.push('### Review feedback on the prior PR');
      parts.push('');
      parts.push('_No review comments on the prior PR._');
    }

    if (prior.jiraCommentsSince.length > 0) {
      parts.push('');
      const since = prior.endedAt ? ` after the prior attempt ended (${prior.endedAt})` : '';
      parts.push(`### Jira comments added${since}`);
      for (const c of prior.jiraCommentsSince) {
        parts.push('');
        parts.push(`#### ${c.author} — ${c.createdAt}`);
        parts.push('');
        parts.push(adfToMarkdown(c.bodyAdf) || '_(empty comment)_');
      }
    }

    parts.push('');
    parts.push(
      'Address this feedback in your changes. Do not undo prior work unless the feedback explicitly asks for it.',
    );
  }

  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(
    `Your task: implement the changes described above to resolve Jira issue ${issue.key}. ` +
      'Work in the current branch and current working directory. Make commits as you go. ' +
      `When you're done, emit the completion signal: ${COMPLETION_SIGNAL}`,
  );

  return parts.join('\n');
}
