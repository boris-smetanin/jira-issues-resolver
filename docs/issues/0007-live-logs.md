# 0007 — Live logs (NDJSON + Tailer + SSE + UI panel)

## What to build

A live-log panel on the Space detail page that streams every event from the in-flight Resolve Attempt as it happens. Per Q9: per-attempt NDJSON files on disk, SSE transport via Hono's `streamSSE`, file-tailer polling 250ms. Pretty / Raw toggle in the UI.

Build:

- `logs/attempt-log.ts` — writer. `createAttemptLog({ spaceId, attemptId, logFilePath }) → AttemptLogger`. Each `log(level, src, msg, data?)` appends one `{ ts, src, level, msg, data? }` JSON line to the file via a write stream. Also forwards to the app-level logger for top-level visibility (matches reference's pattern).
- `logs/log-tailer.ts` — reader. Lifted verbatim from the auto-bug-fixer reference (`server/src/logs/log-tailer.ts`). Polls a file from a saved byte offset, emits parsed lines via callback. Safe across multiple writers.
- `logs/logs.service.ts` — SSE driver `streamLogs(spaceId, stream)`. Pumps `attempt_start` / `line` / `attempt_end` / `idle` events. Pins to whichever attempt is currently non-terminal for the Space; switches tailers when a new attempt starts. Lifted shape from the reference's `streamFixAttemptLogs`.
- Routes on api.controller:
  - `GET /api/spaces/:id/logs/stream` — SSE; returns `streamSSE(c, ...)`.
  - `GET /api/spaces/:id/resolve-attempts/:rid/logs` — plain text dump of the NDJSON file (or `''` if missing).
- `orchestrator/orchestrator.service.ts` updated:
  - Calls `createAttemptLog` at start; records `log_file_path` on the attempt row (e.g. `data/logs/<attemptId>.ndjson`).
  - Logs every transition: `log.log('info', 'orchestrator', 'state → PREPARING_REPO')`, etc.
  - Logs every git/GitHub/Jira call's outcome (`'git', 'info', 'fetched origin'`).
  - Passes `onEvent` into Sandcastle Runner that writes each agent text chunk as `('sandcastle', 'info', 'agent: <chunk>', { type: 'text' | 'tool_call' })`.
  - On `close()` at end of attempt.
- Web: `LiveLogsPanel` component on Space detail. Subscribes to the SSE endpoint via `EventSource`. Renders lines in a scrolling pane. Pretty mode formats `[ts] [src] [level] msg` with color; Raw mode shows the JSON. Toggle in a header. Auto-scrolls to bottom unless user scrolls up. "Idle" state shows a placeholder message.

## Acceptance criteria

- [ ] During an in-flight attempt, the live log panel updates within ~300ms of each new event (poll interval 250ms).
- [ ] Each NDJSON file at `data/logs/<attemptId>.ndjson` contains one valid JSON object per line, in chronological order.
- [ ] Killing the SSE connection (close browser tab) does not leak file handles or break the orchestrator.
- [ ] Pretty / Raw toggle re-renders the existing buffer without dropping any lines.
- [ ] When an attempt finishes, the panel emits `attempt_end` and goes to `idle` until the next attempt starts.
- [ ] When a new attempt starts mid-SSE-session, the panel emits `attempt_start` with the new attempt's id and starts tailing the new file.
- [ ] `GET .../resolve-attempts/:rid/logs` returns the full historical content as `text/plain` (used by the per-attempt page in slice 0010).

## Blocked by

- 0005 — First real tick: agent runs locally, commits in worktree (no push)

(Independent of 0006; can run in parallel.)
