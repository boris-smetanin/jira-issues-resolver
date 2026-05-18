# Working with Claude Code in this project

## Commit workflow

**Always ask before committing.** Even when the user has previously said "commit", show the changes first and wait for explicit approval before running `git commit`.

The minimum context to surface before asking:

- `git status` — what's staged vs. untracked.
- `git diff --stat` — what files changed and how big the changes are.
- A short summary of the diff (1–2 sentences per non-trivial change).
- The proposed commit message.

Only run `git commit` after the user confirms. The same flow applies to `gh pr create` — show the title + body, confirm, then create the PR.

## Code conventions

### Relative TS imports end in `.js`

Source files are `.ts`, but relative imports are written with a `.js` extension:

```ts
import { getSettings } from './settings.repository.js';   // file is .ts
```

This is the standard TypeScript ESM convention — TS intentionally does not rewrite import specifiers during compilation, so source uses the *runtime* extension. tsx (server) and Vite (web) resolve `.js → .ts` transparently, so it works in dev and the prod runtime image alike. Keeps the source portable if we ever swap tsx for `tsc`-compiled output.

Don't "fix" the `.js` to `.ts`; it's deliberate.

## Other anchor docs

- [CONTEXT.md](CONTEXT.md) — domain language. Use these terms (Space, Resolve Attempt, Tick, etc.) in code, copy, and PR descriptions; avoid the variants listed under `_Avoid_`.
- [docs/prd.md](docs/prd.md) — the product spec.
- [docs/adr/](docs/adr/) — architectural decisions that are deliberate, not oversights. Read before "fixing" anything that looks structurally unusual.
- [docs/issues/](docs/issues/) — slice specs. Each slice on GitHub maps 1:1 to a file here.
