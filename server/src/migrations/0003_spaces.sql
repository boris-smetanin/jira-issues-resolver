-- Slice 1's stub `spaces` table only had id/name/created_at. No data has
-- been written yet, so DROP+CREATE with the full schema rather than ALTER.
DROP TABLE IF EXISTS spaces CASCADE;

CREATE TABLE spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,

  github_repo_url TEXT NOT NULL,
  github_token_enc TEXT NOT NULL,
  github_committer_name TEXT NOT NULL,
  github_committer_email TEXT NOT NULL,
  base_branch TEXT NOT NULL DEFAULT 'main',

  agent_provider TEXT NOT NULL CHECK (agent_provider IN ('claude', 'codex')),
  agent_model TEXT NOT NULL,
  agent_runtime_mode TEXT NOT NULL DEFAULT 'host' CHECK (agent_runtime_mode IN ('host', 'container')),
  dockerfile_content TEXT,

  jira_project TEXT NOT NULL,
  filter_field TEXT NOT NULL CHECK (filter_field IN ('component', 'labels', 'fixVersion')),
  filter_value TEXT NOT NULL,
  allowed_statuses TEXT[] NOT NULL,
  agent_labels TEXT[] NOT NULL,
  target_status_name TEXT NOT NULL,

  tick_interval_seconds INT NOT NULL DEFAULT 300
    CHECK (tick_interval_seconds >= 30 AND tick_interval_seconds <= 3600),
  loop_running BOOLEAN NOT NULL DEFAULT false,

  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spaces_active ON spaces (created_at DESC) WHERE deleted_at IS NULL;
