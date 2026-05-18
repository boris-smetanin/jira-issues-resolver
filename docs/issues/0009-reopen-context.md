# 0009 — Reopen context injection

## What to build

When the orchestrator creates a new Resolve Attempt and `prior_attempt_id` is non-null, fetch the prior PR's review comments and the Jira comments added after the prior attempt's `ended_at`, and inject both into the prompt as a "this issue was previously attempted" block. Implements Q7 (reopens implicit) and the user stories around reopen behavior.

Branch reuse is already handled in slice 0005 (`branch.resolver` picks up `origin/<issueKey>` when it exists), so the git side of "this is a reopen" already works. This slice adds the *context-injection* side.

Build:

- `integrations/jira/jira.client.ts` gets `getCommentsSince(key, sinceIso) → Array<...>`. Same as `getComments` but with a `?startedAfter=<iso>` filter (or client-side filter if the API doesn't support it).
- `integrations/github/github.client.ts` gets `listPRReviewComments({ owner, repo, prNumber, token }) → Array<{ user, body, ts, path?, line? }>`. Octokit's `pulls.listReviewComments` + `pulls.listComments` (issue comments on the PR).
- `orchestrator/prompt.formatter.ts` extended: when `priorAttempts.length > 0`, append a block:
  ```
  This Jira issue was previously attempted.
  Prior PR: <last-prior.pr_url>

  Review feedback on the prior PR:
  <rendered list of PR review comments + PR-issue comments,
   newest first; truncated to N most-recent if very long>

  Jira comments added after the prior attempt ended at
  <prior.ended_at>:
  <rendered list of new Jira comments, oldest first>

  Address this feedback in your changes. Do not undo prior work
  unless the feedback explicitly asks for it.
  ```
- `orchestrator/orchestrator.service.ts` updated: when `attempt.prior_attempt_id` is non-null, fetch prior attempt row, then fetch prior PR review comments (if `prior.pr_url` is non-null) and Jira comments since `prior.ended_at`. Pass to `promptBuilder.build({ issue, comments, priorAttempts })`.
- Commit Finalizer (slice 0005) already records `Prior-Attempt: <uuid>` trailer when `priorAttemptId` is passed. Verify it's wired through.

## Acceptance criteria

- [ ] Manually: complete one full attempt for a Jira issue → reviewer leaves comments on the PR → reviewer closes the PR unmerged → transition the Jira issue back to a matching status with the `reopen` label. Next tick creates a new attempt whose log line for the prompt-build step contains text from one of the PR review comments and any Jira comments since the prior attempt's `ended_at`.
- [ ] The new attempt's commit body contains both `Resolve-Attempt: <new-uuid>` and `Prior-Attempt: <prior-uuid>` as git trailers.
- [ ] The new attempt's local branch was created from `origin/<issueKey>` (the prior remote branch), not from `origin/<baseBranch>` — already true from slice 0005; this slice does not change branch resolution, only the prompt.
- [ ] If a prior attempt has `pr_url = null` (e.g. it FAILED before opening a PR), the PR-comment fetch is skipped; Jira-comments-since still happens.
- [ ] If the new attempt is the first ever for a `(space, issue)` (no priors), no reopen block is emitted in the prompt.

## Blocked by

- 0006 — Push + PR open + Jira transition (full happy path)
