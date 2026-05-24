-- Slice 0015: soft-delete terminal Resolve Attempts. `deleted_at` lets
-- the user hide noisy attempts from the per-Space grouped-by-issue
-- list without losing history (attempt + log file remain queryable by
-- direct ID via the per-attempt detail URL).
--
-- Service layer enforces "terminal only" — the column itself is
-- permissive so a future "force-stop and hide" admin path can write to
-- it without a DB rule change. Partial index keeps the visible-row
-- lookups (the only hot path) the same speed as before — the index
-- scan ignores hidden rows entirely.
ALTER TABLE resolve_attempts
  ADD COLUMN deleted_at TIMESTAMPTZ;

DROP INDEX IF EXISTS idx_attempts_by_ended;
CREATE INDEX idx_attempts_by_ended ON resolve_attempts (ended_at)
  WHERE deleted_at IS NULL;
