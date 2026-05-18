# 0003 — Create Space form + sync validation

## What to build

The full Create Space flow. End-to-end: user clicks "+ New Space" → fills in every field → clicks Save → server runs five sync validations in order → on success, the Space row lands in DB and the user is redirected to the (still-bare) Space detail page; on failure, the form surfaces the specific error.

Build:

- Migration `0003_spaces.sql` — the full `spaces` schema from the PRD (every column including `agent_runtime_mode` default `'host'` and `dockerfile_content` nullable). Loop OFF by default (`loop_running` defaults to `false`). Soft-delete via `deleted_at`.
- `spaces/` domain: `spaces.repository.ts` (Kysely; encrypt `github_token`, exclude soft-deleted from `find*` by default), `spaces.service.ts` (create with full validation, list-active, find-by-id), `dto/create-space.dto.ts` (zod schema mirroring the form).
- Two routes on api.controller: `POST /api/spaces` (create), `GET /api/spaces/:id` (get one — used for the post-create redirect).
- Sync validations on create (return 400 on any failure with a field-specific message):
  1. Shape parses (zod).
  2. Jira global creds exist; `GET /myself` returns 200.
  3. `GET https://api.github.com/repos/:owner/:repo` with the Space's PAT returns 200.
  4. Construct JQL from filter fields, POST `/rest/api/3/search` with `maxResults: 0` — must return 200.
  5. `git ls-remote https://x-access-token:<token>@github.com/:owner/:repo.git` must succeed.
- `integrations/jira/jira.client.ts` gets `searchJql({ jql, maxResults }) → JiraSearchResult`.
- `integrations/github/github.client.ts` first method: `getRepo({ owner, repo, token })`.
- `integrations/git/git.client.ts` first method: `lsRemote(url, token) → { ok: bool, err?: string }`.
- Web: `NewSpacePage` with form fields: name, github_repo_url, github_token, github_committer_name, github_committer_email, base_branch (default `main`), agent_provider (`claude` | `codex`), agent_model (Claude options + Codex placeholder for now), jira_project, filter_field (`component` | `labels` | `fixVersion`), filter_value, allowed_statuses (multi-select; user types space-separated and submits), agent_labels (multi-select; default `queued`, `reopen`), target_status_name, tick_interval_seconds (default 300). Form shows a spinner during submit.
- Spaces grid (slice 0001) updated to show real rows: card per Space with name, repo URL, loop state ("Off"), placeholder counts ("0 / 0").

## Acceptance criteria

- [ ] Submitting an invalid GitHub PAT returns 400 with a message like "GitHub: token cannot access repo X".
- [ ] Submitting an unparseable JQL (e.g. invalid status) returns 400 with the Jira error mirrored.
- [ ] Successful submit creates a row with all fields present; `github_token_enc` is encrypted at rest.
- [ ] Soft-deleted Spaces are excluded from `GET /api/spaces`; their attempts (added in slice 4) can still be queried by ID.
- [ ] Space detail page exists (can be bare — just renders the Space's name + a "Verify repo" button stub).
- [ ] Dockerfile-related fields are NOT in the form yet; container mode lands in slice 0011.

## Blocked by

- 0002 — Global Jira settings + Crypto module
