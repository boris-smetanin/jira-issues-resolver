import {
  commit,
  headSubjectBody,
  resetSoft,
  revList,
} from '../integrations/git/git.client.js';

export type FinalizeArgs = {
  worktreePath: string;
  baseRef: string;
  issueKey: string;
  attemptId: string;
  priorAttemptId?: string | null;
};

export type FinalizeResult = { commits: 0 | 1 };

// Strip a leading "<ISSUE-KEY>" / "<ISSUE-KEY>:" / "<ISSUE-KEY> -" from the
// subject so we don't end up with "RND-7050 RND-7050 …" when the agent
// already prefixed its own commit message.
function stripIssueKeyPrefix(subject: string, issueKey: string): string {
  const re = new RegExp(`^${issueKey}[\\s:\\-]*`, 'i');
  return subject.replace(re, '').trim();
}

// Per Q24: if the agent made commits, squash them into one whose message
// is `<ISSUE-KEY> <agent-subject>\n\n<agent-body>\n\nResolve-Attempt: <id>`
// (plus Prior-Attempt trailer on reopens). Soft-reset preserves the index
// + working tree state from HEAD, so we just commit again.
export async function finalize(args: FinalizeArgs): Promise<FinalizeResult> {
  const newSha = await revList(args.worktreePath, args.baseRef, 'HEAD');
  if (newSha.length === 0) {
    return { commits: 0 };
  }

  const { subject: rawSubject, body } = await headSubjectBody(args.worktreePath);
  const cleanSubject = stripIssueKeyPrefix(rawSubject, args.issueKey) || 'resolve attempt';

  await resetSoft(args.worktreePath, args.baseRef);

  const trailers = [`Resolve-Attempt: ${args.attemptId}`];
  if (args.priorAttemptId) {
    trailers.push(`Prior-Attempt: ${args.priorAttemptId}`);
  }

  const message = [
    `${args.issueKey} ${cleanSubject}`,
    '',
    body,
    '',
    trailers.join('\n'),
  ]
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === '')) // collapse double blanks
    .join('\n');

  await commit(args.worktreePath, message);
  return { commits: 1 };
}
