# jira-issues-resolver

Locally-installed web app that drains a configured set of Jira issues by orchestrating an AI coding agent to produce a pull request per issue. See [docs/prd.md](docs/prd.md) and [CONTEXT.md](CONTEXT.md) for the domain language.

## Prerequisites

- Node 22+ (`.nvmrc` pins 22)
- pnpm 11 (`brew install pnpm`)
- Docker + Compose v2 (for Postgres)

## Install

```sh
pnpm install
cp .env.example .env
```

## Run

```sh
docker compose up -d                # Postgres 16 on :5433
pnpm --filter @jir/server dev       # API on :3001 (applies migrations on boot)
pnpm --filter @jir/web dev          # UI on :3000
```

Open <http://localhost:3000>.

## Layout

- `server/` — Hono + Kysely API. All HTTP routes in `server/src/api.controller.ts` (see [ADR-0002](docs/adr/0002-single-api-controller.md)).
- `web/` — Vite + React 19 + Tailwind v4 + shadcn/ui.
- `shared/` — types shared between server and web.
- `docs/` — PRD, ADRs, and per-slice issue specs.
