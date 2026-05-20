import type { AttemptStatus, ResolveAttempt } from '@jir/shared';
import type { Selectable } from 'kysely';
import type { ResolveAttemptsTable } from '../core/db.js';
import { getDb } from '../core/db.js';

type AttemptRow = Selectable<ResolveAttemptsTable>;

function rowToAttempt(row: AttemptRow): ResolveAttempt {
  return {
    id: row.id,
    spaceId: row.space_id,
    issueKey: row.issue_key,
    attemptNumber: row.attempt_number,
    priorAttemptId: row.prior_attempt_id,
    status: row.status,
    branchName: row.branch_name,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    errorReason: row.error_reason,
    stuckAtStatus: row.stuck_at_status,
    transitionWarning: row.transition_warning,
    logFilePath: row.log_file_path,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
  };
}

export type CreateAttemptInput = {
  spaceId: string;
  issueKey: string;
  attemptNumber: number;
  priorAttemptId: string | null;
  branchName: string | null;
};

export async function create(input: CreateAttemptInput): Promise<ResolveAttempt> {
  const row = await getDb()
    .insertInto('resolve_attempts')
    .values({
      space_id: input.spaceId,
      issue_key: input.issueKey,
      attempt_number: input.attemptNumber,
      prior_attempt_id: input.priorAttemptId,
      status: 'QUEUED',
      branch_name: input.branchName,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return rowToAttempt(row);
}

export async function findById(id: string): Promise<ResolveAttempt | null> {
  const row = await getDb()
    .selectFrom('resolve_attempts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? rowToAttempt(row) : null;
}

// Returns all attempts for a (space, issue) pair, oldest first. Used by
// createNextAttempt to pick the next attempt_number and prior_attempt_id.
export async function findPriorsForIssue(
  spaceId: string,
  issueKey: string,
): Promise<ResolveAttempt[]> {
  const rows = await getDb()
    .selectFrom('resolve_attempts')
    .selectAll()
    .where('space_id', '=', spaceId)
    .where('issue_key', '=', issueKey)
    .orderBy('attempt_number', 'asc')
    .execute();
  return rows.map(rowToAttempt);
}

// Any non-terminal attempt for (space, issue). The "no in-flight" rule:
// only create a new attempt if this returns null.
export async function findInFlightForIssue(
  spaceId: string,
  issueKey: string,
): Promise<ResolveAttempt | null> {
  const row = await getDb()
    .selectFrom('resolve_attempts')
    .selectAll()
    .where('space_id', '=', spaceId)
    .where('issue_key', '=', issueKey)
    .where('status', 'not in', ['FINISHED', 'FINISHED_NO_CHANGES', 'FAILED'])
    .executeTakeFirst();
  return row ? rowToAttempt(row) : null;
}

// Most-recent non-terminal attempt across all issues in a Space. The
// scheduler is serial-per-Space, so at most one is past QUEUED at any
// time; we surface whichever one is "running" (in whatever sense) so
// slice-7 SSE has a single attempt to follow.
export async function findRunningForSpace(spaceId: string): Promise<ResolveAttempt | null> {
  const row = await getDb()
    .selectFrom('resolve_attempts')
    .selectAll()
    .where('space_id', '=', spaceId)
    .where('status', 'not in', ['FINISHED', 'FINISHED_NO_CHANGES', 'FAILED'])
    .orderBy('started_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? rowToAttempt(row) : null;
}

export async function listBySpace(spaceId: string): Promise<ResolveAttempt[]> {
  const rows = await getDb()
    .selectFrom('resolve_attempts')
    .selectAll()
    .where('space_id', '=', spaceId)
    .orderBy('started_at', 'desc')
    .execute();
  return rows.map(rowToAttempt);
}

// Slice 8: flip every non-terminal row to FAILED with the given reason.
// Called at boot to reconcile attempts that were mid-state-machine when the
// previous process died. `stuck_at_status` records what the status was so
// the attempt-history UI can show where it died.
//
// Returns the IDs that were flipped so the boot log can record how many.
export async function markOrphanedAttempts(reason: string): Promise<string[]> {
  const rows = await getDb()
    .updateTable('resolve_attempts')
    .set((eb) => ({
      status: 'FAILED',
      error_reason: reason,
      stuck_at_status: eb.ref('status'),
      ended_at: new Date(),
    }))
    .where('status', 'not in', ['FINISHED', 'FINISHED_NO_CHANGES', 'FAILED'])
    .returning('id')
    .execute();
  return rows.map((r) => r.id);
}

// Generic transition: status → newStatus, optional terminal-state fields.
// Slice 4 uses this only for FINISHED_NO_CHANGES; slice 5+ uses it for the
// full state machine (PREPARING_REPO → AGENT_RUNNING → ... → FINISHED).
export async function transitionStatus(
  id: string,
  status: AttemptStatus,
  fields?: {
    errorReason?: string;
    stuckAtStatus?: AttemptStatus;
    transitionWarning?: string;
    branchName?: string;
    prUrl?: string;
    prNumber?: number;
    logFilePath?: string;
    endedAt?: Date;
  },
): Promise<ResolveAttempt> {
  const row = await getDb()
    .updateTable('resolve_attempts')
    .set({
      status,
      ...(fields?.errorReason !== undefined ? { error_reason: fields.errorReason } : {}),
      ...(fields?.stuckAtStatus !== undefined ? { stuck_at_status: fields.stuckAtStatus } : {}),
      ...(fields?.transitionWarning !== undefined
        ? { transition_warning: fields.transitionWarning }
        : {}),
      ...(fields?.branchName !== undefined ? { branch_name: fields.branchName } : {}),
      ...(fields?.prUrl !== undefined ? { pr_url: fields.prUrl } : {}),
      ...(fields?.prNumber !== undefined ? { pr_number: fields.prNumber } : {}),
      ...(fields?.logFilePath !== undefined ? { log_file_path: fields.logFilePath } : {}),
      ...(fields?.endedAt !== undefined ? { ended_at: fields.endedAt } : {}),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return rowToAttempt(row);
}
