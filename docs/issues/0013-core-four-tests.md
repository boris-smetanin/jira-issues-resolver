# 0013 — Tests for the Core 4 (Prompt Builder, Branch Resolver, Commit Finalizer, Crypto)

## What to build

Anchor the four most testable, most architecturally load-bearing modules with proper unit/integration tests. Per the PRD's testing decisions, these are the cheapest-to-test, highest-payoff modules; they also encode the divergences from the reference (Q10 branch reuse, Q24 squash-amend) and the security primitive.

Build:

- Vitest setup in `server/` (`vitest.config.ts`, `package.json` script).
- Helper utilities under `server/src/__test__/`:
  - `tmpGitRepo()` — creates a temp directory, `git init`, configures a fake remote (bare repo at sibling dir), returns helpers to manipulate state.
  - `loadFixture(name)` — loads JSON fixtures from `__fixtures__/`.
- **Crypto tests** (`server/src/core/crypto.test.ts`):
  - Round-trip: `decrypt(encrypt(s)) === s` for empty, short, and long strings.
  - Tamper detection: flipping a byte in IV / tag / ciphertext throws.
  - Wrong-key detection: encrypting with key A and decrypting with key B throws.
  - Key length validation at module load: a 31-byte and a 33-byte MASTER_KEY throws at import-time.
- **Prompt Builder tests** (`server/src/orchestrator/prompt.formatter.test.ts`):
  - Snapshot tests against fixtures under `server/src/orchestrator/__fixtures__/`:
    - `simple-issue.json` (Jira issue, no comments, no priors) → snapshot
    - `multi-comment.json` (Jira issue with 5 comments including ADF code blocks, mentions, panels) → snapshot
    - `reopen-once.json` (issue + comments + one prior FINISHED attempt with PR review comments) → snapshot
    - `reopen-with-multiple-priors.json` → snapshot
    - `no-description-only-comments.json` → snapshot
  - Use Vitest's inline snapshot (`toMatchInlineSnapshot`) for the prompt string OR file-snapshot under `__snapshots__/`. Failures require explicit reapproval (`vitest --update-snapshots`).
- **Branch Resolver tests** (`server/src/orchestrator/branch.resolver.test.ts`):
  - Uses `tmpGitRepo()`.
  - `prepareWorktree({ space, attempt })` when `origin/<issueKey>` does NOT exist → asserts the worktree is on a new branch off `origin/<baseBranch>`, the worktree dir exists, the working tree is clean.
  - When `origin/<issueKey>` exists → worktree tracks it; HEAD matches `origin/<issueKey>`'s head sha.
  - When the persistent clone doesn't exist yet → it's created on first call.
  - When called twice for the same issueKey → the second call cleans up the prior worktree and creates a fresh one (no leftover state).
- **Commit Finalizer tests** (`server/src/orchestrator/commit.finalizer.test.ts`):
  - Uses `tmpGitRepo()`.
  - Zero new commits since base → `{ commits: 0 }`, no changes to HEAD.
  - One commit with subject already prefixed (`RND-1 Fix bug`) → squash dedupes the prefix.
  - One commit with subject NOT prefixed (`Fix bug`) → squash prepends.
  - Three commits → squashed to one; HEAD~1 is the base; subject uses the last commit's subject.
  - With `priorAttemptId` passed → final commit body contains `Prior-Attempt: <uuid>` trailer; parse the trailer with `git interpret-trailers --parse` to verify it's machine-readable.
  - Untracked files in the worktree are NOT included in the squashed commit.
  - Empty agent subject → fallback subject is used (`<ISSUE-KEY> resolve attempt <N>`).

## Acceptance criteria

- [ ] `pnpm --filter server test` runs all four test files, all green.
- [ ] Crypto tests cover the four cases above; coverage report shows 100% on `core/crypto.ts`.
- [ ] Prompt Builder snapshots are checked in; an intentional prompt-text change requires `--update-snapshots` and shows up as a diff in the PR.
- [ ] Branch Resolver tests use a real `git` binary against a temp repo (not mocks).
- [ ] Commit Finalizer tests use a real `git` binary; the trailer-parse step verifies trailer format compliance.
- [ ] All tests run in under 30 seconds total on a modern laptop (target; will need optimization if exceeded).
- [ ] CI config (GitHub Actions stub if no GitHub remote yet — leave as a `.github/workflows/ci.yml.example`) for future automation.

## Blocked by

- 0005 — First real tick: agent runs locally, commits in worktree (no push)

(Prompt Builder, Branch Resolver, Commit Finalizer all land in slice 0005. Crypto lands in slice 0002 — testing it could in principle start earlier, but bundling all four together keeps the testing slice cohesive.)
