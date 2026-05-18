# 0010 — Attempt history UI + per-attempt detail page

## What to build

The Space detail page's Resolve Attempts list grouped by Jira issue, with each issue's attempt history expandable inline. Each attempt is clickable, leading to a dedicated detail page that shows the historical NDJSON log, the prompt that was sent to the agent, and the attempt's metadata.

End-to-end: on a Space with attempts → see one row per Jira issue with the latest attempt's status + PR link → click an issue row to expand prior attempts → click any attempt to navigate to its detail page → see the full historical log + the prompt that was sent + the timing/status/error metadata.

Build:

- `resolve-attempts.service.ts` gains `listGroupedByIssue(spaceId) → Array<{ issueKey, attempts: ResolveAttempt[] }>` — latest first per issue, ordered by latest attempt's `started_at` desc.
- `resolve-attempts.service.ts` gains `findByIdWithPriors(attemptId) → { attempt, priors: [], next: ResolveAttempt | null }` for the detail page (used to show navigation between attempts in a chain).
- Persist the rendered prompt alongside the attempt: add a `prompt_rendered` text column to `resolve_attempts` via migration `0006_prompt_column.sql`. Populated by the orchestrator in slice 0005 (retrofit). NULL on attempts created before this slice.
- Routes on api.controller:
  - `GET /api/spaces/:id/resolve-attempts` returns the grouped list (used by Space detail page).
  - `GET /api/resolve-attempts/:id` returns one attempt + its priors + next link.
  - Existing `GET /api/spaces/:id/resolve-attempts/:rid/logs` already serves historical NDJSON.
- Web: rewrite Space detail's attempts list:
  - One card per Jira issue, headlined by the latest attempt's state badge.
  - Latest attempt's PR link if non-null.
  - "▸ history (N)" chevron to expand prior attempts inline.
  - Each attempt row in the expanded history clickable → routes to `/resolve-attempts/:id`.
- New page `ResolveAttemptDetailPage` at route `/resolve-attempts/:id`:
  - Metadata header: issue key, attempt number, status (with stuck_at_status on FAILED), branch, PR link, started_at, ended_at, duration.
  - Tabs: "Log" (loads the historical NDJSON via the existing endpoint, same Pretty/Raw toggle from slice 0007), "Prompt" (renders `prompt_rendered` in a monospace pane), "Metadata" (the raw row as a JSON pane).
  - "Stop attempt" button visible only when status is non-terminal (used in slice 0015).
  - Breadcrumb back to the Space.

## Acceptance criteria

- [ ] Space detail page shows one row per Jira issue (not per attempt) in the main list.
- [ ] Expanding RND-2's row reveals the FAILED attempt 1 below the FINISHED attempt 2.
- [ ] Clicking attempt 1 navigates to `/resolve-attempts/<ra_002>`; the historical log is loaded; the Prompt tab shows the exact prompt text the agent saw.
- [ ] For attempts created in slice 0005+ but before this slice, `prompt_rendered` is NULL → the Prompt tab shows "(no prompt recorded for this attempt)".
- [ ] An attempt that's still non-terminal shows a live indicator on its detail page; if the user opens the Log tab, it falls through to live SSE (the same endpoint from slice 0007).

## Blocked by

- 0007 — Live logs (NDJSON + Tailer + SSE + UI panel)
