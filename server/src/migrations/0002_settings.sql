CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY CHECK (id = 1),
  jira_email TEXT,
  jira_api_token_enc TEXT,
  jira_base_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;
