-- Slice 8: loop scheduler. Two new columns.
--
-- settings.global_concurrency_cap — bounds how many runAttempt invocations
-- can be in flight at once across all Spaces. Default 3.
--
-- spaces.last_tick_at — timestamp the last tick fired for a Space (worker
-- ticks AND manual "Tick now" both update it). Surfaced on the grid card.

ALTER TABLE settings
  ADD COLUMN global_concurrency_cap INT NOT NULL DEFAULT 3
    CHECK (global_concurrency_cap >= 1 AND global_concurrency_cap <= 50);

ALTER TABLE spaces
  ADD COLUMN last_tick_at TIMESTAMPTZ;
