# 0004 — Tick-now → empty Resolve Attempt → FINISHED_NO_CHANGES

## What to build

The thinnest possible tracer through the Resolve Loop machinery: a "Tick now" button creates Resolve Attempt rows in the DB but does no real work — every attempt is immediately marked `FINISHED_NO_CHANGES`. Proves that the JQL → attempt-creation → terminal-state path is wired without dragging in the agent or git.

End-to-end: open a Space's detail page → click "Tick now" → server runs the JQL → for each matching Jira issue with no in-flight attempt, INSERT a row with `status = QUEUED`, then immediately UPDATE to `FINISHED_NO_CHANGES` → return list to UI → user sees N attempt rows for their matching Jira issues.

Build:

- Migration `0004_resolve_attempts.sql` — full `resolve_attempts` schema from the PRD (every column, the `CHECK` on status, all three indexes, and the `UNIQUE (space_id, issue_key, attempt_number)` constraint).
- `resolve-attempts/` domain: `resolve-attempts.repository.ts` (Kysely; create, find-by-id, find-priors-for-issue, find-in-flight-for-space, find-by-space), `resolve-attempts.service.ts` (create-next-attempt — handles attempt_number increment + prior_attempt_id wiring), `dto/`.
- `resolve-loop/` domain: `resolve-loop.service.ts` — exports `tickOnce(spaceId)`. For now: run JQL → for each matching issue, check "any in-flight attempt?" → if none, create QUEUED → immediately transition to FINISHED_NO_CHANGES (placeholder; real orchestration arrives in slice 0005).
- Two routes on api.controller: `POST /api/spaces/:id/loop/tick-now` (returns the list of created attempts), `GET /api/spaces/:id/resolve-attempts` (returns rows).
- Web: a "Tick now" button on the Space detail page. After click, refresh the attempts list below. Bare table showing issue_key + status + started_at.

## Acceptance criteria

- [ ] Clicking "Tick now" on a Space with matching Jira issues creates one row per unique matching issue (skipping any with a non-terminal prior attempt).
- [ ] All rows are in `FINISHED_NO_CHANGES` state immediately.
- [ ] Clicking "Tick now" again does NOT create duplicate rows for the same issue, because the prior row exists in a terminal state — but the loop rule says "create new attempt only if no priors are non-terminal"; verify the behavior: another tick creates a SECOND attempt (attempt_number=2, prior_attempt_id set) for each matching issue. This is correct per Q7 — reopens happen via this exact path.
- [ ] The UI table shows attempt_number when > 1.
- [ ] No agent runs, no git operations, no GitHub/Jira writes occur. Only Jira reads.
- [ ] If Jira's `/search` 4xxs, the tick returns an error to the UI and creates no rows.

## Blocked by

- 0003 — Create Space form + sync validation
