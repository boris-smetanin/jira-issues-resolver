# jira-issues-resolver

Locally-installed web app that drains a configured set of Jira issues by orchestrating an AI coding agent to produce a pull request per issue. See [docs/prd.md](docs/prd.md) and [CONTEXT.md](CONTEXT.md) for the domain language.

## Prerequisites

- Docker + Compose v2 — needed in every mode.
- For native dev only: Node 22+ (`.nvmrc` pins 22) and pnpm 11 (`brew install pnpm`).

## Install

```sh
cp .env.example .env
pnpm install   # only needed for native dev
```

## Run

Three modes — pick whichever fits your workflow.

### Dev in Docker (default)

Whole stack runs in containers; host file edits trigger live reload inside.

```sh
docker compose up --build
```

- UI on <http://localhost:3000> (vite, HMR)
- API on <http://localhost:3001> (tsx watch)
- Postgres on `localhost:5433`

Bind-mounts the repo into `/app` in both `server` and `web` containers; pnpm's `node_modules` symlink tree is preserved via anonymous volumes. File watching uses polling (`CHOKIDAR_USEPOLLING=true`) for reliability on macOS.

### Native dev

Server and web run on the host; only Postgres is containerised.

```sh
docker compose up postgres -d
pnpm --filter @jir/server dev   # API on :3001
pnpm --filter @jir/web dev      # UI on :3000
```

### Prod shape (single container)

The image as it would deploy: one Node process serves `/api/*`, `/health`, and the built SPA (with client-side-route fallback) on a single port.

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

- App on <http://localhost:3000> — UI at `/`, API at `/api/*`
- Postgres on `localhost:5433`

The `-f docker-compose.prod.yml` overlay drops the dev `server`/`web` services and replaces them with a single `app` service built from the Dockerfile's `runtime` stage.

## Layout

- `server/` — Hono + Kysely API. All HTTP routes in `server/src/api.controller.ts` (see [ADR-0002](docs/adr/0002-single-api-controller.md)). In prod, `server/src/app.ts` additionally serves `web/dist` as static + SPA fallback.
- `web/` — Vite + React 19 + Tailwind v4 + shadcn/ui.
- `shared/` — types shared between server and web.
- `docs/` — PRD, ADRs, and per-slice issue specs.
- `Dockerfile` — multi-stage (`base`, `deps`, `dev`, `build`, `runtime`). Debian-flavoured base so the slice-0011 Dockerfile merger stays compatible.
- `docker-compose.yml` — dev (default).
- `docker-compose.prod.yml` — prod overlay (one service, port 3000).
