# 0008 — Resolve Loop scheduler + orphan reconciliation

## What to build

Per-Space auto-ticking. Start/Stop buttons, configurable tick interval, auto-resume on boot, orphan reconciliation on boot, global concurrency cap. Replaces the manual "Tick now" as the primary use mode — `Tick now` stays as an explicit-trigger button.

Build:

- `resolve-loop/resolve-loop.service.ts`:
  ```
  workers = Map<spaceId, Worker>

  startLoop(spaceId):
    if workers.has(spaceId): return  // idempotent
    spaces.repository.setLoopRunning(spaceId, true)
    const w = scheduleTicks(spaceId)
    workers.set(spaceId, w)

  stopLoop(spaceId):
    workers.get(spaceId)?.stop()
    workers.delete(spaceId)
    spaces.repository.setLoopRunning(spaceId, false)

  tickNow(spaceId):
    workers.get(spaceId)?.tickNow()
       ?? orchestrator.runOneTickAdHoc(spaceId)

  resumeRunningLoops():  // call from index.ts boot
    spaces.repository.findAllRunning()
      .forEach(s => startLoop(s.id))
  ```
- Worker = an async loop `while (running) { await tick(); await sleep(space.tick_interval_seconds * 1000) }`. `tickNow` interrupts the sleep via an AbortController.
- Global semaphore at the orchestrator boundary: a single `pLimit(3)` (or hand-rolled queue) guards `orchestrator.runAttempt`. Concurrency cap is configurable via `settings.global_concurrency_cap` (add column to `settings` table via migration `0005_global_cap.sql`; default 3).
- `markOrphanedAttempts(reason)` in `resolve-attempts.service.ts`. SQL: `UPDATE resolve_attempts SET status='FAILED', error_reason=$reason, stuck_at_status=status, ended_at=now() WHERE status NOT IN (FINISHED, FINISHED_NO_CHANGES, FAILED)`. Returns updated IDs for logging.
- `server/src/index.ts` updated:
  ```
  initDb(...)
  initAppLogger(...)
  const orphans = markOrphanedAttempts('orphaned at boot')
  if (orphans.length) logEvent({...})
  resumeRunningLoops()
  startLogCleanupTimer(logsDir)  // slice 0014 will own this; placeholder for now
  // ...serve
  ```
- Routes on api.controller:
  - `POST /api/spaces/:id/loop/start`
  - `POST /api/spaces/:id/loop/stop`
  - `POST /api/spaces/:id/loop/tick-now` (already exists from slice 0004; now routes through the worker if running, ad-hoc otherwise)
  - `PATCH /api/spaces/:id/loop/interval` (validates 30 ≤ seconds ≤ 3600)
- Graceful shutdown: `stopAllLoops()` invoked from SIGTERM / SIGINT handlers; awaits in-flight ticks to finish (with a 10s force-exit timer matching the reference).
- Web: Space detail page Start / Stop buttons (one toggles based on `loop_running`), an interval input (seconds) bound to PATCH, the existing "Tick now" button stays.
- Space card on the grid now shows live loop state ("Running" / "Stopped") and last tick timestamp.

## Acceptance criteria

- [ ] Click Start on a Space → `loop_running = true`, the worker begins ticking on the interval, the UI shows "Running".
- [ ] Click Stop → `loop_running = false`, the in-flight tick completes (no force-kill), the worker exits, the UI shows "Stopped".
- [ ] Restart the server with a previously-running Space → the loop resumes automatically.
- [ ] `markOrphanedAttempts` runs BEFORE `resumeRunningLoops` (verify ordering: a mid-PUSHING row at SIGKILL ends up FAILED + 'orphaned at boot' on next boot, even if the loop subsequently starts a new tick).
- [ ] With 5 Spaces all running and all hitting tickable issues simultaneously, only 3 agents run concurrently; the rest queue.
- [ ] PATCH interval rejects values outside [30, 3600] with a 400.
- [ ] `Tick now` works whether or not the loop is running.

## Blocked by

- 0006 — Push + PR open + Jira transition (full happy path)
