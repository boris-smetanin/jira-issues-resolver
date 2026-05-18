# 0014 — Log retention sweeper + configurable retention

## What to build

Per the PRD's Q9: an hourly background task that deletes NDJSON log files older than the configured retention (default 30 days). Configurable from the Settings page. Lifted-and-adapted from the auto-bug-fixer reference's `startLogCleanupTimer`.

Build:

- Migration `0008_retention_setting.sql` — add `log_retention_days` column to `settings` table; default 30; CHECK between 1 and 365.
- `logs/cleanup.ts` (or extension of `logs.service.ts`):
  - `cleanupOldLogs(logsDir, retentionDays) → CleanupResult` — scan `data/logs/*.ndjson`, get each file's `mtime` (or join to `resolve_attempts.ended_at` for accuracy on log files whose mtime drifted), delete files older than the cutoff. Return removed list.
  - `startLogCleanupTimer(logsDir)` — `setInterval(1h)` (also fires once on startup). Reads retention from settings each tick (so config changes apply within an hour).
  - `stopLogCleanupTimer()` — invoked from the SIGTERM/SIGINT handlers added in slice 0008.
- `server/src/index.ts`: wire `startLogCleanupTimer` into boot, after `resumeRunningLoops`.
- Route on api.controller: `PATCH /api/settings/log-retention` accepts `{ days: number }`; validates against the CHECK; persists.
- Settings page gains a "Log retention (days)" input next to the Jira credentials section.
- Cleanup also deletes the `log_file_path` reference effect: when a row's NDJSON file is deleted, the row stays (for history), but `GET .../logs` for that row returns the empty string (matching reference behavior — log_file_path read returns `''` on ENOENT).

## Acceptance criteria

- [ ] On boot, `startLogCleanupTimer` runs once and removes any files older than retentionDays.
- [ ] Hourly thereafter, the sweeper runs and logs removed count to the app log.
- [ ] Changing `log_retention_days` from 30 to 7 via the UI reduces the next sweep's surviving files accordingly.
- [ ] A row whose NDJSON file has been swept still renders in the UI (history is preserved); the per-attempt detail page's Log tab shows "(logs expired)" instead of crashing.
- [ ] On graceful shutdown, `stopLogCleanupTimer()` is invoked; the in-flight sweep (if any) completes within the 10s shutdown grace.
- [ ] Out-of-range retention values (0, -1, 366) are rejected by the API with 400.

## Blocked by

- 0007 — Live logs (NDJSON + Tailer + SSE + UI panel)
