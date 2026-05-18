# Working with Claude Code in this project

## Commit and PR workflow

**Claude never runs `git commit`, `git push`, or `gh pr create` in this project.** The user runs those themselves.

At the end of a unit of work, surface enough that the user can commit without re-deriving the context:

- `git status` — what's staged vs. untracked.
- `git diff --stat` — what files changed.
- A short summary of the diff (1–2 sentences per non-trivial change).
- A proposed commit message the user can copy-paste verbatim.
- For PRs: a proposed PR title and body, also copy-pasteable.

When the work resolves a tracked issue, put a closing keyword (`Closes #N.`) in the **PR body** — that's the location GitHub uses for auto-close across all merge strategies (squash-and-merge drops keywords that only live in individual commit messages).

Read-only git/gh operations (`git status`, `git log`, `git diff`, `gh issue view`, `gh pr view`, etc.) are fine — just don't run anything that mutates the repo, the remote, or the issue tracker.

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
