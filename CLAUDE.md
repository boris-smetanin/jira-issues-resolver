# Working with Claude Code in this project

## Commit workflow

**Always ask before committing.** Even when the user has previously said "commit", show the changes first and wait for explicit approval before running `git commit`.

The minimum context to surface before asking:

- `git status` — what's staged vs. untracked.
- `git diff --stat` — what files changed and how big the changes are.
- A short summary of the diff (1–2 sentences per non-trivial change).
- The proposed commit message.

Only run `git commit` after the user confirms. The same flow applies to `gh pr create` — show the title + body, confirm, then create the PR.

## Other anchor docs

- [CONTEXT.md](CONTEXT.md) — domain language. Use these terms (Space, Resolve Attempt, Tick, etc.) in code, copy, and PR descriptions; avoid the variants listed under `_Avoid_`.
- [docs/prd.md](docs/prd.md) — the product spec.
- [docs/adr/](docs/adr/) — architectural decisions that are deliberate, not oversights. Read before "fixing" anything that looks structurally unusual.
- [docs/issues/](docs/issues/) — slice specs. Each slice on GitHub maps 1:1 to a file here.
