import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolveAttempt } from '@jir/shared';
import { addComment, addLabel, type JiraCreds } from '../integrations/jira/jira.client.js';
import type { AttemptLogger } from '../logs/attempt-log.js';
import { setEscalationMd, transitionStatus } from '../resolve-attempts/resolve-attempts.repository.js';

// Slice 16b: escalation flow.
//
// When the agent decides it cannot safely commit (per the discipline in
// the prompt / /diagnose skill), it writes `.jir/escalation.md` in the
// worktree and makes ZERO commits. The orchestrator detects the file
// post-agent-run; this handler reads it, posts a Jira comment with the
// write-up, adds the `agent-escalated` label so the JQL filter excludes
// the issue on future ticks, and transitions the attempt to ESCALATED.
//
// Failure modes the handler must survive:
// - File present but unreadable → log + treat as FAILED (no escalation
//   metadata to post; the attempt is broken).
// - Jira comment post fails → log + still continue (attempt becomes
//   ESCALATED, the write-up is in the DB even if it didn't reach Jira).
// - Label add fails → log + still continue (without the label the
//   issue may get re-spawned; warning in log makes that traceable).

export const ESCALATION_FILE_RELPATH = '.jir/escalation.md';
export const AGENT_ESCALATED_LABEL = 'agent-escalated';

export type EscalationCheck =
  | { kind: 'not-escalated' }
  | { kind: 'escalated'; content: string };

// Cheap synchronous-ish check used by the orchestrator to decide whether
// the agent escalated. Returns the file content if present + readable;
// returns `not-escalated` otherwise (file missing OR unreadable — we
// don't distinguish here because either way the agent didn't produce a
// valid escalation).
export async function checkForEscalation(worktreePath: string): Promise<EscalationCheck> {
  const fullPath = join(worktreePath, ESCALATION_FILE_RELPATH);
  if (!existsSync(fullPath)) return { kind: 'not-escalated' };
  try {
    const content = (await readFile(fullPath, 'utf8')).trim();
    if (content.length === 0) return { kind: 'not-escalated' };
    return { kind: 'escalated', content };
  } catch {
    return { kind: 'not-escalated' };
  }
}

// Drives the full ESCALATED transition. Called from the orchestrator
// when (a) the agent finished with zero commits, AND (b)
// checkForEscalation returned `escalated`.
export async function handleEscalation(args: {
  attempt: ResolveAttempt;
  issueKey: string;
  content: string;
  jiraCreds: JiraCreds;
  log: AttemptLogger;
}): Promise<void> {
  const { attempt, issueKey, content, jiraCreds, log } = args;

  log.log('info', 'orchestrator', 'agent escalated — file detected, processing');

  // 1. Persist the write-up to the DB. If Jira/label calls fail, the
  // attempt-detail UI still has the full content.
  await setEscalationMd(attempt.id, content);
  log.log('info', 'orchestrator', `escalation_md persisted (${content.length} chars)`);

  // 2. Jira comment. Soft-fail — log + continue.
  const commentBody = `🤖 Agent escalation\n\n${content}`;
  try {
    await addComment(jiraCreds, issueKey, commentBody);
    log.log('info', 'jira', 'escalation comment posted');
  } catch (err) {
    log.log(
      'warn',
      'jira',
      `failed to post escalation comment: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Add agent-escalated label so JQL excludes this issue from future
  // ticks. Soft-fail — log + continue (without the label, the loop may
  // re-spawn on this issue, but the explicit warning in the log makes
  // that traceable).
  try {
    await addLabel(jiraCreds, issueKey, AGENT_ESCALATED_LABEL);
    log.log('info', 'jira', `added "${AGENT_ESCALATED_LABEL}" label`);
  } catch (err) {
    log.log(
      'warn',
      'jira',
      `failed to add escalation label: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. Mark the attempt ESCALATED (terminal).
  await transitionStatus(attempt.id, 'ESCALATED', { endedAt: new Date() });
  log.log('info', 'orchestrator', 'state → ESCALATED');
}
