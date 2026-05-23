-- Slice 0014: hourly log-retention sweeper. Per-Space attempt logs are
-- written to <dataDir>/logs/<attemptId>.ndjson and never grow-bound by
-- anything else, so without this we'd accumulate forever.
--
-- Default 30 days matches the PRD's Q9 answer. CHECK (1..365) puts a
-- hard floor (0/negative would race against in-flight writes) and a
-- soft ceiling (a year is already past the point where logs are useful
-- — flag it instead of silently letting users set 10_000).

ALTER TABLE settings
  ADD COLUMN log_retention_days INT NOT NULL DEFAULT 30
    CHECK (log_retention_days BETWEEN 1 AND 365);
