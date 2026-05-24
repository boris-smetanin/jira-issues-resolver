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
    promptRendered: row.prompt_rendered,
    escalationMd: row.escalation_md,
    depsInstalledForAttempt: row.deps_installed_for_attempt,
    promptShape: row.prompt_shape,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
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
    .where('deleted_at', 'is', null)
    .orderBy('started_at', 'desc')
    .execute();
  return rows.map(rowToAttempt);
}

// Slice 15: soft-delete a terminal attempt. Caller (attempts.service)
// validates the status guard; the repo accepts any id so a future
// admin path doesn't need a DB rule change. Idempotent.
export async function softDelete(id: string): Promise<void> {
  await getDb()
    .updateTable('resolve_attempts')
    .set({ deleted_at: new Date() })
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .execute();
}

// Slice 10: persist the rendered prompt right after the orchestrator
// builds it, so the per-attempt detail page can render exactly what the
// agent saw.
export async function setPromptRendered(id: string, prompt: string): Promise<void> {
  await getDb()
    .updateTable('resolve_attempts')
    .set({ prompt_rendered: prompt })
    .where('id', '=', id)
    .execute();
}

// Slice 16a: persist the resolved prompt shape (bug / code-improvement /
// feature) so the per-attempt detail page can render a badge and so we
// can analyse outcomes per shape later. Null on attempts where the
// issuetype didn't match any configured list — should be rare since the
// JQL filter excludes those issues, but defensible if the user
// misconfigures the lists.
export async function setPromptShape(
  id: string,
  shape: 'bug' | 'code-improvement' | 'feature' | null,
): Promise<void> {
  await getDb()
    .updateTable('resolve_attempts')
    .set({ prompt_shape: shape })
    .where('id', '=', id)
    .execute();
}

// Slice 16b: persist the escalation write-up the agent left in
// .jir/escalation.md. Called by the escalation handler before
// transitioning to ESCALATED.
export async function setEscalationMd(id: string, content: string): Promise<void> {
  await getDb()
    .updateTable('resolve_attempts')
    .set({ escalation_md: content })
    .where('id', '=', id)
    .execute();
}

// Slice 16b: observability flag for the orchestrator-driven dep install
// step (code-improvement-shape only).
export async function setDepsInstalled(id: string, installed: boolean): Promise<void> {
  await getDb()
    .updateTable('resolve_attempts')
    .set({ deps_installed_for_attempt: installed })
    .where('id', '=', id)
    .execute();
}

export type GroupedListResult = {
  groups: Array<{ issueKey: string; attempts: ResolveAttempt[] }>;
  total: number;
  page: number;
  pageSize: number;
};

export type GroupedListOptions = {
  // 0-based page index.
  page: number;
  // Bounded 1..100 by the caller (controller).
  pageSize: number;
  // Case-insensitive substring filter on `issue_key`. Empty / undefined
  // means no filter.
  search?: string;
};

// Slice 10 (extended): paginated grouping by Jira issue. Three queries:
//   1) DISTINCT issue keys for this space (optionally search-filtered),
//      ordered by the issue's latest started_at desc, with LIMIT/OFFSET
//      driving the page size.
//   2) Total distinct issue count for the same predicate — drives the
//      "Showing N–M of TOTAL" footer.
//   3) All attempts for the keys returned by (1), so the UI can render
//      every attempt in each visible issue group without N+1.
//
// We don't paginate at the attempt level — pagination is "issues per
// page". An issue with 30 attempts still shows all 30 inside its card
// (currently feasible; if a single issue ever grows to thousands of
// attempts we'd add a per-bucket limit).
export async function listGroupedByIssueForSpace(
  spaceId: string,
  opts: GroupedListOptions,
): Promise<GroupedListResult> {
  const db = getDb();
  const search = opts.search?.trim();
  const searchPattern = search && search.length > 0 ? `%${search}%` : null;

  // (1) distinct issue keys for the visible page, ordered by their issue's
  // latest started_at desc.
  let keyQuery = db
    .selectFrom('resolve_attempts')
    .select((eb) => [
      'issue_key as issueKey',
      eb.fn.max('started_at').as('latestStartedAt'),
    ])
    .where('space_id', '=', spaceId)
    .where('deleted_at', 'is', null)
    .groupBy('issue_key');
  if (searchPattern) {
    keyQuery = keyQuery.where('issue_key', 'ilike', searchPattern);
  }
  const keyRows = (await keyQuery
    .orderBy('latestStartedAt', 'desc')
    .limit(opts.pageSize)
    .offset(opts.page * opts.pageSize)
    .execute()) as Array<{ issueKey: string; latestStartedAt: Date }>;

  // (2) total distinct issue count for the same predicate — drives the
  // "Showing N–M of TOTAL" footer.
  let countQuery = db
    .selectFrom('resolve_attempts')
    .select((eb) => eb.fn.count<string>('issue_key').distinct().as('total'))
    .where('space_id', '=', spaceId)
    .where('deleted_at', 'is', null);
  if (searchPattern) {
    countQuery = countQuery.where('issue_key', 'ilike', searchPattern);
  }
  const totalRow = await countQuery.executeTakeFirstOrThrow();
  // pg's COUNT() returns bigint → string via node-postgres; coerce to
  // number for the JSON response.
  const total =
    typeof totalRow.total === 'string' ? Number(totalRow.total) : (totalRow.total as number);

  if (keyRows.length === 0) {
    return { groups: [], total, page: opts.page, pageSize: opts.pageSize };
  }

  // (3) all attempts for those keys
  const issueKeys = keyRows.map((r) => r.issueKey);
  const attemptRows = await db
    .selectFrom('resolve_attempts')
    .selectAll()
    .where('space_id', '=', spaceId)
    .where('issue_key', 'in', issueKeys)
    .where('deleted_at', 'is', null)
    .orderBy('started_at', 'desc')
    .execute();

  const buckets = new Map<string, ResolveAttempt[]>();
  for (const row of attemptRows) {
    const attempt = rowToAttempt(row);
    const existing = buckets.get(attempt.issueKey);
    if (existing) existing.push(attempt);
    else buckets.set(attempt.issueKey, [attempt]);
  }

  // Preserve the order from (1) — that's the canonical
  // "latest-first by issue" ordering for the page.
  const groups = keyRows.map((r) => ({
    issueKey: r.issueKey,
    attempts: buckets.get(r.issueKey) ?? [],
  }));

  return { groups, total, page: opts.page, pageSize: opts.pageSize };
}

// Slice 10: detail page navigation. Returns the attempt + every prior in
// the (space, issue) chain (oldest first) + the next attempt if this one
// already has a successor.
export async function findByIdWithChain(id: string): Promise<{
  attempt: ResolveAttempt;
  priors: ResolveAttempt[];
  next: ResolveAttempt | null;
} | null> {
  const attempt = await findById(id);
  if (!attempt) return null;

  const allInChain = await getDb()
    .selectFrom('resolve_attempts')
    .selectAll()
    .where('space_id', '=', attempt.spaceId)
    .where('issue_key', '=', attempt.issueKey)
    .orderBy('attempt_number', 'asc')
    .execute();

  const priors = allInChain
    .filter((r) => r.attempt_number < attempt.attemptNumber)
    .map(rowToAttempt);
  const nextRow = allInChain.find((r) => r.attempt_number === attempt.attemptNumber + 1);
  return {
    attempt,
    priors,
    next: nextRow ? rowToAttempt(nextRow) : null,
  };
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
    .where('deleted_at', 'is', null)
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
