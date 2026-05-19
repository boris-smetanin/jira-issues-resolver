CREATE TABLE agent_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex')),
  name TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Multiple accounts per provider OK, but each needs a distinct label.
  UNIQUE (provider, name)
);

-- Spaces now reference an agent account. ON DELETE RESTRICT keeps the user
-- from silently breaking running Spaces — deletion errors if any Space points
-- at the account.
ALTER TABLE spaces
  ADD COLUMN agent_account_id UUID REFERENCES agent_accounts(id) ON DELETE RESTRICT;

-- agent_provider was redundant once the account carries the provider
-- (joined via FK). Existing rows lose their provider hint; the matching
-- Space needs `agent_account_id` assigned in the UI before it can tick.
ALTER TABLE spaces DROP COLUMN agent_provider;

CREATE INDEX idx_spaces_by_account ON spaces (agent_account_id);
