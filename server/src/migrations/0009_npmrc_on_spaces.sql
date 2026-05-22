-- Slice 16b: optional private-package auth for code-improvement-shape
-- dep-installs. The Space carries an env-var name (e.g. NPM_REGISTRY_TOKEN)
-- and the encrypted token value; the installer injects the env var before
-- running `pnpm install` / `npm ci` / etc.
--
-- Why two columns instead of a single JSON blob: the project's committed
-- `.npmrc` references a specific env-var name (sometimes NPM_TOKEN,
-- sometimes NODE_AUTH_TOKEN, sometimes NPM_REGISTRY_TOKEN), so we store
-- the name explicitly. The split also keeps the encrypted value isolated
-- to a single column for easier rotation.
--
-- Either both columns are set or both are null — enforced by the CHECK
-- constraint. A "half-configured" state is always a misconfiguration.

ALTER TABLE spaces
  ADD COLUMN npmrc_env_name TEXT,
  ADD COLUMN npmrc_env_value_enc TEXT,
  ADD CONSTRAINT spaces_npmrc_both_or_neither
    CHECK ((npmrc_env_name IS NULL) = (npmrc_env_value_enc IS NULL));
