# 0001 — Project scaffold + empty Spaces grid

## What to build

The foundation every other slice rests on. End-to-end: a user runs `docker compose up` then `pnpm dev`, opens `http://localhost:3000`, sees a page titled "Spaces" with an empty grid and a placeholder "+ New Space" button. The button does nothing yet; the grid reads from the empty `spaces` table via the api.controller.

Lay down:

- pnpm monorepo with three workspaces: `server/`, `web/`, `shared/`.
- `server/`: Hono on Node 22, `index.ts` bootstrap, `app.ts` wiring, `api.controller.ts` as the single HTTP gateway (per ADR-0002), `core/{config,db,logger}.ts`, `migrations/` runner that applies `migrations/*.sql` alphabetically against a `_migrations` tracking table, Kysely + pg pool wired through a hand-written `Database` interface. First migration `0001_init.sql` creates an empty `spaces` table (full schema can land in slice 3).
- `web/`: Vite + React 19 + Tailwind v4 + shadcn/ui scaffold. Single page (`SpacesGrid`) that fetches `GET /api/spaces` and renders results.
- `shared/`: skeleton with the `Space` type stub.
- `docker-compose.yml` at root: Postgres 16 only. Volume for the DB.
- `.env.example` documents `DATABASE_URL`, `PORT`, `DATA_DIR`.

## Acceptance criteria

- [ ] `pnpm install && docker compose up -d && pnpm --filter server dev` brings up the server with migrations applied.
- [ ] `pnpm --filter web dev` brings up the UI; navigating to it shows the Spaces page with an empty list and a "+ New Space" button.
- [ ] `GET /api/spaces` returns `[]` from the api.controller.ts (not from a per-domain controller).
- [ ] `_migrations` table exists in Postgres with row `{ name: '0001_init.sql' }`.
- [ ] `shared/` is consumed by both `server/` and `web/` via workspace imports.
- [ ] README documents the install + run sequence.

## Blocked by

None — can start immediately.
