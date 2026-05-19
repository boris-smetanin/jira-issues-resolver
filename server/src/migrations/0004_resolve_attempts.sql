CREATE TABLE IF NOT EXISTS resolve_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  issue_key TEXT NOT NULL,
  attempt_number INT NOT NULL CHECK (attempt_number >= 1),
  prior_attempt_id UUID REFERENCES resolve_attempts(id),

  -- Full state machine from CONTEXT.md. Slice 4 only uses QUEUED and
  -- FINISHED_NO_CHANGES; the other states arrive in slices 5+. Encoding
  -- them all here is cheaper than ALTERing the CHECK constraint each slice.
  status TEXT NOT NULL CHECK (status IN (
    'QUEUED', 'PREPARING_REPO', 'AGENT_RUNNING', 'CHECKING_COMMITS',
    'PUSHING', 'OPENING_PR', 'TRANSITIONING_JIRA',
    'FINISHED', 'FINISHED_NO_CHANGES', 'FAILED'
  )),

  branch_name TEXT,
  pr_url TEXT,
  pr_number INT,
  error_reason TEXT,
  stuck_at_status TEXT,
  transition_warning TEXT,
  log_file_path TEXT,

  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,

  UNIQUE (space_id, issue_key, attempt_number)
);

CREATE INDEX idx_attempts_by_status ON resolve_attempts (space_id, status);
CREATE INDEX idx_attempts_by_issue ON resolve_attempts (space_id, issue_key, started_at DESC);
CREATE INDEX idx_attempts_by_ended ON resolve_attempts (ended_at);
