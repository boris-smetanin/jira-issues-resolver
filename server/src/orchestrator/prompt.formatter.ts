import { adfToMarkdown } from '../integrations/adf/adf.formatter.js';
import type { JiraComment, JiraIssue } from '../integrations/jira/jira.client.js';

export type BuildPromptArgs = {
  issue: JiraIssue;
  comments: JiraComment[];
  // Reopen context arrives in slice 9; for slice 5 this is unused.
  priorAttempts?: Array<{ id: string; endedAt: string | null; prUrl: string | null }>;
};

const COMPLETION_SIGNAL = '<promise>COMPLETE</promise>';

export function buildPrompt(args: BuildPromptArgs): string {
  const { issue, comments } = args;
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
