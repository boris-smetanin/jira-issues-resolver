-- Slice 10: persist the rendered prompt alongside each attempt so the
-- per-attempt detail page can show exactly what the agent saw. NULL on
-- attempts created before this slice; the UI shows "(no prompt recorded
-- for this attempt)" in that case.

ALTER TABLE resolve_attempts
  ADD COLUMN prompt_rendered TEXT;
