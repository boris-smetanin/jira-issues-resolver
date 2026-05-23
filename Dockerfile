ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# base: Debian-flavoured Node with git + pnpm. Debian (not Alpine/distroless)
# so this image is forward-compatible with the slice-0011 Dockerfile merger
# (apt-get, useradd, etc. need to keep working when an agent layer is added).
#
# Both agent CLIs (Claude Code + OpenAI Codex) are installed globally so
# Sandcastle's factory can spawn either one. Adding a third provider later
# means appending another package to the npm install line below.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
# Slice 11: docker-cli is needed by the orchestrator's container-mode
# path — it shells out to `docker build` / `docker run` / `docker exec`
# against the host daemon (socket mounted by docker-compose). We only
# need the client; the daemon stays on the host.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git ca-certificates curl gosu docker.io \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@11.1.2 @anthropic-ai/claude-code @openai/codex \
 && pnpm config set store-dir /root/.local/share/pnpm/store

# Slice 16b: pre-bake the bug-shape /diagnose skill into the agent's
# HOME so both Claude Code and OpenAI Codex pick it up. Same content,
# two paths because each CLI scans a different directory convention.
# The entrypoint chowns /home/agent to node:node on every container
# start, so these files end up owned by node.
COPY docker/skills/diagnose /home/agent/.claude/skills/diagnose
COPY docker/skills/diagnose /home/agent/.agents/skills/diagnose

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# ---------------------------------------------------------------------------
# deps: install workspace deps from lockfile only. Cached unless lockfile or
# any package.json changes.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# dev: image used by docker-compose.yml for both server and web services
# during local development. No CMD — compose sets it per service. Source
# comes in via bind mount; node_modules layers preserved via anonymous
# volumes.
# ---------------------------------------------------------------------------
FROM base AS dev
COPY --from=deps /app /app
EXPOSE 3000 3001

# ---------------------------------------------------------------------------
# build: produces web/dist (static assets consumed by the runtime stage).
# Server has no compiled build step; tsx runs the TS sources directly in
# prod so we copy server/ as-is.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN pnpm --filter @jir/web build

# ---------------------------------------------------------------------------
# runtime (prod): single image that serves both /api/* and the built SPA on
# one port. Hono's serveStatic + SPA-fallback middleware (enabled when
# NODE_ENV=production) handles every request. Talks to postgres by service
# name and reaches the host Docker daemon via the socket mount (slice 0011).
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=build /app/tsconfig.base.json ./
COPY --from=build /app/shared shared
COPY --from=build /app/server server
COPY --from=build /app/web/package.json web/package.json
COPY --from=build /app/web/dist web/dist
RUN pnpm install --frozen-lockfile --filter "@jir/server..."
EXPOSE 3000
CMD ["pnpm", "--filter", "@jir/server", "start"]
