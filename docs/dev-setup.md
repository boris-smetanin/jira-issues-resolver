# Dev setup

How to get this project running locally, fill in the `.env`, and execute the test suite. This complements the user-facing [README.md](../README.md), which covers the three run modes (dev-in-Docker, native, prod) at a higher level.

## TL;DR

```sh
git clone <repo-url>
cd jira-issues-resolver
cp .env.example .env          # then edit — see "Environment" below
docker compose up --build     # first boot: ~2–5 min for the image
```

Open <http://localhost:3000>. Done.

Run tests:

```sh
pnpm install                              # one-time (only for native test runs)
pnpm --filter @jir/server test            # 33 tests, ~6 seconds
```

## Prerequisites

- **Docker + Compose v2** — required for every run mode.
- **Node 22+** and **pnpm 11** (`brew install pnpm`) — required for running tests locally and for native (non-Docker) dev. Skip if you only ever run via `docker compose`.

The `.nvmrc` pins Node 22. If you use `fnm` / `nvm`, run `nvm use` (or `fnm use`) once in the repo root.

## Environment

Copy `.env.example` to `.env`, then fill in the values. Every variable below has a sensible default for local dev — the file is mostly here so you can override per-machine.

| Variable | Default if blank | What it does |
|---|---|---|
| `MASTER_KEY` | Auto-generated on first boot and appended to `.env` | AES-256-GCM key for encrypting Jira/GitHub tokens at rest. **Once data is encrypted with a key, you cannot rotate it without losing the encrypted data.** Back up your `.env` if you've connected real accounts. |
| `DATABASE_URL` | `postgres://jir:jir@postgres:5432/jir` (set by compose) | Server's Postgres connection string. The compose file overrides this to the in-network value, so you almost never need to set it in `.env`. |
| `PORT` / `SERVER_PORT` | `3001` | API port (server container + host). |
| `WEB_PORT` | `3000` | UI port (web container + host). |
| `POSTGRES_PORT` | `5432` | Internal Postgres port; host port is set in `docker-compose.yml`. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `jir` / `jir` / `jir` | Postgres credentials. Compose uses these to bootstrap the database. |
| `DATA_DIR` | `/data` inside the server container; `./data` natively | Where the server caches per-Space git clones, worktrees, and the per-Space container Dockerfiles (`<dataDir>/repos/<spaceId>/...`). |
| `MOCK_AGENT` | `1` in compose (uses scaffolded agent, no LLM calls) | Set to `0` to invoke the real Claude / Codex CLI. Costs money — only flip when you actually want a live agent run. |

### First-boot MASTER_KEY auto-generation

If `MASTER_KEY` is blank when the server starts, the server generates a fresh 32-byte key, appends it to `.env`, and continues. Subsequent boots reuse it. The auto-generation logic lives in `server/src/core/config.ts` — read it before changing it.

### When you'd manually set MASTER_KEY

- Prod or any environment without a writable `.env` (the server can't auto-write).
- You want to share an encrypted DB between machines.
- You're restoring from a backup made with a known key.

Generate one with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Running the project

### Most common: dev in Docker

```sh
docker compose up --build           # first boot or after Dockerfile changes
docker compose up -d                # subsequent boots, detached
docker compose logs -f server       # tail server logs
docker compose logs -f web          # tail UI build / HMR logs
docker compose down                 # stop everything (data persists in named volumes)
```

- **UI**: <http://localhost:3000> (Vite HMR — edits hot-reload).
- **API**: <http://localhost:3001> (`tsx watch` — restarts on file changes).
- **Postgres**: `localhost:5433` (compose maps the internal 5432 to host 5433).

The repo is bind-mounted into `/app` in both `server` and `web` containers, so host file edits are picked up live without rebuilding the image.

### When you need to rebuild the image

The image only needs rebuilding when one of these changes:

- The root `Dockerfile`
- `pnpm-lock.yaml` or any `package.json` (deps changed)
- `docker-entrypoint.sh`

For everything else (TypeScript source, web assets, config files), the bind mount + `tsx watch` / Vite HMR picks the change up live.

```sh
docker compose build server && docker compose up -d server
```

### Native dev (faster restart, harder setup)

If you'd rather run the server/web processes on the host (and only put Postgres in Docker):

```sh
docker compose up postgres -d
pnpm install                         # one-time
pnpm --filter @jir/server dev        # API on :3001 (tsx watch)
pnpm --filter @jir/web dev           # UI on :3000 (vite dev)
```

Caveats: native dev means slice 11's container-mode Spaces won't work the same way (the orchestrator needs the host Docker socket and a named volume layout that compose sets up). Stick with dev-in-Docker unless you have a reason.

## Running tests

The server has a Vitest suite covering the four most architecturally load-bearing modules (Crypto, Prompt Builder, Branch Resolver, Commit Finalizer). **Tests are fully offline and never invoke a real LLM** — safe to run as often as you like, zero token cost, zero risk of touching real GitHub / Jira.

### Run once

```sh
pnpm --filter @jir/server test
```

33 tests, ~6 seconds wall-clock.

### Watch mode (re-runs on save)

```sh
pnpm --filter @jir/server test:watch
```

Keys while running: `q` to quit, `r` to re-run all, `f` to re-run only failed tests.

### With coverage

```sh
pnpm --filter @jir/server exec vitest run --coverage
```

Prints a table at the bottom and writes an HTML report to `server/coverage/index.html`.

### Single file

```sh
pnpm --filter @jir/server exec vitest run src/core/crypto.test.ts
```

### Single test by name (substring match on `describe` / `it` text)

```sh
pnpm --filter @jir/server exec vitest run -t "round-trip"
```

### Updating snapshots

The Prompt Builder uses file snapshots under `server/src/orchestrator/__snapshots__/`. When you intentionally change a prompt template, the snapshot test fails with a diff. To accept the new snapshot:

```sh
pnpm --filter @jir/server exec vitest run -u
```

The snapshot file change then shows up in your PR for explicit review.

## Useful pnpm scripts

Run from the repo root:

```sh
pnpm --filter @jir/server dev         # API in watch mode
pnpm --filter @jir/web dev            # UI in vite dev
pnpm --filter @jir/server test        # server tests
pnpm --filter @jir/server typecheck   # server tsc --noEmit
pnpm -r build                         # build all workspaces
pnpm lint                             # eslint
pnpm format                           # prettier --write
```

## Troubleshooting

### "MASTER_KEY must decode to 32 bytes"

Either your `.env` has a bad value or no value at all *and* `.env` isn't writable. Generate a new key with the snippet under "Environment" above, paste it into `.env`, restart.

### "ENOSPC: no space left on device" inside the server container

Docker Desktop's VM disk is full. Open Docker Desktop → Settings → Resources → bump the disk image size, *or* prune unused images / build cache:

```sh
docker system df                    # see what's eating space
docker image prune -af              # safe: drops unreferenced images
docker builder prune -af            # safe: drops build cache
```

**Don't** run `docker system prune --volumes` — that wipes the named volumes (`jir-data` for repo clones, `jir-pg` for Postgres data).

### "permission denied while trying to connect to the Docker daemon socket"

Slice 11 (container-mode agent) needs the host Docker socket reachable from inside the server container. The entrypoint script chmods it on boot, but if you started the container without rebuilding after that change, run:

```sh
docker compose exec --user root server chmod 666 /var/run/docker.sock
```

For a persistent fix, rebuild: `docker compose build server && docker compose up -d server`.

### Port already in use (3000 / 3001 / 5433)

Something else on your machine is bound to one of these. Either stop it, or set `WEB_PORT` / `SERVER_PORT` / `POSTGRES_PORT` in `.env` to free ports.

### Tests fail with "MASTER_KEY is not set"

Tests set this themselves via `server/vitest.setup.ts`. If you're seeing this, you're probably running the tests with an unusual entrypoint (raw `vitest` without the config). Use `pnpm --filter @jir/server test` instead.

### Agent runs are burning real tokens unexpectedly

Make sure `MOCK_AGENT=1` is set (default in `docker-compose.yml`). The mock agent writes a note file + makes a single commit, exercising the orchestrator state machine end-to-end with no LLM call. Set to `0` only when you genuinely want a live agent run.

## Where to look next

- [README.md](../README.md) — three-mode overview, layout.
- [CONTEXT.md](../CONTEXT.md) — domain vocabulary (Space, Resolve Attempt, Tick). Use these terms in code and PRs.
- [CLAUDE.md](../CLAUDE.md) — collaboration conventions when working with Claude in this project.
- [docs/prd.md](prd.md) — product spec.
- [docs/adr/](adr/) — architectural decisions (read before "fixing" anything that looks structurally unusual).
- [docs/issues/](issues/) — per-slice specs, one file per slice on GitHub.
- [docs/container-runtime-review.md](container-runtime-review.md) — HITL checklist for slice 11's container-mode Dockerfile review.
