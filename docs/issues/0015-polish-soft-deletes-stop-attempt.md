# 0015 — Polish: soft-deletes + stop-attempt button

## What to build

Three small, related quality-of-life features that depend on the rest of the UI being in place. All are deferred from earlier slices intentionally.

1. **Soft-delete a Space.** The Space row sets `deleted_at`, disappears from the main grid, but its history (resolve attempts + logs) remains queryable by direct ID. Restore is possible via DB only (no UI flow in v1).
2. **Soft-delete a terminal Resolve Attempt.** Hide noise from the attempts grid without losing history. Only terminal states (`FINISHED`, `FINISHED_NO_CHANGES`, `FAILED`) can be soft-deleted. Lifted from the reference's `softDeleteFixAttempt`.
3. **Stop in-flight attempt button.** On the per-attempt detail page from slice 0010, a "Stop attempt" button visible only when status is non-terminal. Triggers an abort: cancels the orchestrator's in-flight work (using `AbortController` plumbed through Sandcastle Runner + Git Client), marks the attempt FAILED with `error_reason = 'stopped by user'`.

Build:

- `spaces.repository.ts` gains `softDelete(id)`. `find*` methods already exclude soft-deleted per slice 0003.
- `resolve-attempts.repository.ts` gains a `deleted_at` column (migration `0009_attempt_soft_delete.sql`) and `softDelete(id)`. `find*` exclude soft-deleted unless `includeDeleted: true`.
- `resolve-attempts.service.ts`:
  - `softDelete(id)` — rejects with 400 if status is non-terminal.
  - `requestStop(id)` — sets a process-wide "stop" flag (via an in-memory `Map<attemptId, AbortController>` populated by the orchestrator when it starts an attempt). The flag is observed by the orchestrator at safe checkpoints.
- `orchestrator/orchestrator.service.ts` updated:
  - At the start of `runAttempt`, register `new AbortController()` for the attempt.
  - At every state transition (between PREPARING_REPO, AGENT_RUNNING, etc.), check `abortSignal.aborted`; if true, jump to FAILED handling with `error_reason = 'stopped by user'`.
  - Pass the abort signal into Sandcastle's `run` (Sandcastle accepts a `signal` option).
  - Pass into Git operations that support it (the long ones like `clone`, `fetch`, `push`).
  - On terminal, unregister from the map.
- Routes on api.controller:
  - `DELETE /api/spaces/:id` → soft-delete.
  - `DELETE /api/resolve-attempts/:id` → soft-delete (rejects non-terminal).
  - `POST /api/resolve-attempts/:id/stop` → request stop.
- Web:
  - Space card has a "..." menu with "Delete". Confirms with "Hide this Space? Attempt history will remain accessible by URL but the Space won't appear in the grid."
  - Per-attempt page's terminal-state header has a "Hide" button.
  - Per-attempt page's non-terminal-state header has a "Stop attempt" button. Confirms with "Stop this attempt? It will be marked FAILED."

## Acceptance criteria

- [ ] Soft-deleting a Space hides it from the main grid; visiting its URL directly still works; its attempts and logs are still served.
- [ ] Attempting to soft-delete an in-flight attempt returns 400 with a clear message.
- [ ] Clicking "Stop attempt" on an in-flight attempt: status transitions to FAILED within a few seconds (next checkpoint or after the in-flight operation accepts the signal); `error_reason = 'stopped by user'`; the worktree is cleaned up; the orchestrator's process is freed (no zombie processes).
- [ ] Soft-deleted attempts are not visible in the Space detail page's grouped-by-issue list (unless a "Show hidden" toggle is added, out of scope for v1).
- [ ] An attempt whose underlying Space has been soft-deleted is still individually navigable by URL.

## Blocked by

- 0010 — Attempt history UI + per-attempt detail page
