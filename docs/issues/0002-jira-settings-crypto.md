# 0002 — Global Jira settings + Crypto module

## What to build

A Settings page where the user enters their Jira email + API token (Jira Cloud, since base URL is `*.atlassian.net`). The token is encrypted at rest with AES-256-GCM. On save, the server validates the credential against `GET /rest/api/3/myself` before persisting.

End-to-end: open Settings page → see "Jira credentials not configured" → enter email + token → click Save → server validates and stores encrypted → page shows "Connected as <displayName>".

Build:

- `core/crypto.ts` — AES-256-GCM encrypt/decrypt. Master key from `MASTER_KEY` env var (32 random bytes, base64). On first boot, if `MASTER_KEY` is absent, generate one and append to `.env`, print a one-time notice. Validate key length at boot.
- Migration `0002_settings.sql` — the `settings` table with single-row constraint (`id INT PRIMARY KEY CHECK (id = 1)`), columns `jira_email`, `jira_api_token_enc`, `created_at`, `updated_at`.
- `settings/` domain: `settings.repository.ts` (Kysely; encrypt on write, decrypt on read), `settings.service.ts` (validate-then-persist), `dto/update-jira-credential.dto.ts`.
- Two routes on `api.controller.ts`: `GET /api/settings/jira` (returns email + a redacted token + connected status), `PUT /api/settings/jira` (validates against `/myself` then persists).
- `integrations/jira/jira.client.ts` first method: `verifyCredential(email, token) → { displayName, accountId }`. Uses Basic auth `base64(email:token)`.
- Web: `SettingsPage` with a form, calls `PUT /api/settings/jira`, shows error or success.

## Acceptance criteria

- [ ] Submitting bad creds returns HTTP 400 with a clear message; nothing persisted.
- [ ] Submitting good creds returns 200 with `connectedAs: <displayName>`; the row in `settings` has the token encrypted (not equal to the plaintext when SELECTed).
- [ ] Restarting the server preserves the credential; the Settings page shows the connected state on reload.
- [ ] `crypto.encrypt('x')` followed by `crypto.decrypt(encrypted)` returns `'x'`.
- [ ] Tampering with the ciphertext (flip a byte) makes `decrypt` throw.
- [ ] If `MASTER_KEY` is absent at boot, the server generates one, writes it to `.env`, and proceeds. If `.env` is read-only or the key length is wrong, the server fails fast with a clear error.
- [ ] Settings page renders a deep-link to `https://id.atlassian.com/manage-profile/security/api-tokens` so the user can mint a token without leaving the app.

## Blocked by

- 0001 — Project scaffold + empty Spaces grid
