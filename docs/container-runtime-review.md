# Reviewing a generated Dockerfile for container-mode Spaces

When you flip a Space's "Container isolation (advanced)" toggle on, the resolver:

1. Clones the Space's GitHub repo (if not cached).
2. Scans for a Dockerfile in this order: `Dockerfile.dev`, `Dockerfile`, `docker/Dockerfile`, `.docker/Dockerfile`.
3. Inlines the detected content (or falls back to a `node:22-bookworm-slim` skeleton).
4. Appends the Sandcastle agent layer.
5. Renders the merged content in a textarea for you to review **before saving**.

The merged Dockerfile is per-Space and lives only in our DB (`spaces.dockerfile_content`). It is never committed to the user's repo.

This checklist is what to look for **before clicking Save**.

---

## 1. Base image compatibility with the agent layer

The agent layer the generator appends assumes a Debian-family base with `apt-get`:

```dockerfile
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      nodejs git curl jq ca-certificates \
 && rm -rf /var/lib/apt/lists/*
```

**Red flags**:

- **Alpine bases** (`alpine:`, `node:*-alpine`, `python:*-alpine`): `apt-get` doesn't exist. Either replace with `apk add --no-cache nodejs git curl jq ca-certificates` or change the base image.
- **Distroless bases** (`gcr.io/distroless/...`): no package manager, no shell. The agent layer can't run. Either switch to a non-distroless variant for the agent's container, OR keep distroless and accept that the agent won't have its standard tooling (read-only investigation only — probably not enough).
- **Scratch bases** (`FROM scratch`): same problem as distroless. Switch base.
- **Outdated Debian/Ubuntu** (Debian 9, Ubuntu 16.04): `apt-get` works but the repos may be archived (404s on `apt-get update`). Either update the base or switch to `archive.debian.org` mirrors.

If your project's Dockerfile uses one of these, edit the merged content before saving — usually the easiest fix is replacing the agent-layer's `apt-get` block with the equivalent for your distro.

---

## 2. Multi-stage Dockerfiles

The generator emits a warning when it detects `FROM ... AS <name>` blocks. Read the warning carefully — it says **the agent layer attaches to the LAST stage only**.

Common multi-stage patterns and what to do:

- **builder → minimal runtime** (`FROM node:22 AS build` ... `FROM nginx:alpine`): The final stage is `nginx:alpine` — no Node, no shell, no apt. Agent layer's `apt-get` fails. **Fix**: either move the agent layer to the `build` stage (cut-and-paste in the editor), or change the final stage's base to something with apt-get.
- **builder → distroless**: Same situation; switch the final stage or attach to the builder.
- **builder → same OS**: e.g. both stages are Debian. Probably fine — verify the final stage has `apt-get` available (some slim variants strip it; `apt-get install apt` from the cached image works as a one-line patch).

---

## 3. BuildKit secrets

The generator emits a **hard warning** if it detects `--mount=type=secret` in any `RUN`. Our Docker provider invokes `docker build` without enabling BuildKit, so any RUN that depends on a secret mount will fail.

**Fix**: either remove those RUNs from the agent's image (the agent doesn't need them — it only needs to investigate code), or rewrite to `ARG NPM_TOKEN` / `ENV` with the token passed at build time. Note: rewriting to ENV bakes the token into image layers; only do this if the image is private and short-lived.

For projects that genuinely need BuildKit secrets to build (some monorepos with private npm registries), the right answer is host mode for now. The BuildKit-enabled image build is a future enhancement.

---

## 4. UID assignment

The agent layer creates a user `agent` and lets `useradd` pick the next free uid:

```dockerfile
RUN id -u agent >/dev/null 2>&1 || useradd -m -s /bin/bash agent
```

We deliberately don't pin uid 1000 — most language base images already own it (`node` in Node images, `lighttpd` in some PHP images, default user in many distros), so pinning would collide. Letting useradd pick avoids the collision entirely.

If you want to reuse an existing user instead (e.g. you'd rather `USER node` than create a fresh `agent` user), replace the line with `USER node` and drop the `useradd`. The orchestrator's `docker exec` calls hard-code `--user root` for sudo'd commands but otherwise inherit whatever `USER` the image was built with — whichever name you use for the agent user is fine as long as the home dir lines up with what the agent CLIs expect (`HOME=/home/<that user>`).

---

## 5. PATH overrides

The agent layer pins `PATH` to the standard Linux defaults:

```dockerfile
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
```

This is load-bearing. Many legacy project Dockerfiles set a custom `ENV PATH=/app/bin:/...` so their app binaries resolve unqualified. Without our reset, the agent's exec environment inherits that custom PATH and can't find `/usr/bin/git`, `/bin/sh`, etc. — Sandcastle's first sandbox probe (`git rev-parse`) exits 127 and the attempt fails.

**Don't delete this ENV** unless you've manually verified your base image's PATH already includes `/usr/bin` and `/bin`.

## 6. WORKDIR and ENTRYPOINT

The agent layer's last lines:

```dockerfile
USER agent
WORKDIR /home/agent
ENTRYPOINT ["sleep", "infinity"]
```

**Don't change these** unless you have a specific reason. The orchestrator runs the agent via `docker exec` into the live container — the ENTRYPOINT only needs to keep the container alive, not to do anything useful. `sleep infinity` is correct.

WORKDIR=/home/agent matches what claude-code and codex CLIs expect for HOME (we set `HOME=/home/agent` at exec time too).

If your project's Dockerfile sets a custom WORKDIR at the end (e.g. `WORKDIR /websites/ongage`), the agent layer's `WORKDIR /home/agent` overrides it — that's the intended behaviour. The agent's exec calls supply `--workdir <worktree>` for the actual work, so the WORKDIR at image-bake time only matters for "where does the shell open by default."

---

## 7. CMD vs ENTRYPOINT

Docker concatenates ENTRYPOINT and CMD into a single argv at runtime. If your project's Dockerfile sets `CMD ["/start.sh"]` and our agent layer sets `ENTRYPOINT ["sleep", "infinity"]` without resetting CMD, the container actually runs:

```
sleep infinity /start.sh
```

`sleep` rejects that and exits 1, the container vanishes immediately, and the orchestrator's next `docker exec` fails with `No such container`.

The agent layer's last two lines guard against this:

```dockerfile
ENTRYPOINT ["sleep", "infinity"]
CMD []
```

`CMD []` resets any inherited CMD to empty. **Don't delete the `CMD []` line** — it's load-bearing for every project Dockerfile that ships a CMD.

---

## What a healthy merged Dockerfile looks like

For a typical TypeScript monorepo:

```dockerfile
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .

# ─── Sandcastle agent layer (generated by jir; edit before saving) ───
USER root
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl jq ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://claude.ai/install.sh | bash
RUN npm install -g @openai/codex
RUN id -u agent >/dev/null 2>&1 || useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent
ENTRYPOINT ["sleep", "infinity"]
CMD []
```

Notes:

- I dropped `nodejs` from the apt install because the base already has Node. Won't hurt to keep it; will pull a Debian-packaged Node that might not match `node:22`.
- Base has `git` already? Some node images do. Verify with `docker run --rm node:22-bookworm-slim which git`.

---

## What to do if container mode is broken for your repo

If the merged Dockerfile won't build (you save it, the next tick fires, and `state → AGENT_RUNNING` errors out with a docker-build failure):

1. Open the attempt's detail page → Log tab. Look for `src: 'install'` or `src: 'sandcastle'` lines with the build output.
2. Common failures:
   - `apt-get: command not found` → Alpine/distroless base (see §1).
   - `useradd: UID 1000 already in use` → uid collision (see §4). The `|| true` should mask this — if you still see it, the agent layer was edited.
   - `unable to prepare context` → docker-from-docker path issue. Probably means I broke `buildSpaceImage`'s tar stream; ping the maintainer.
3. Switch the Space back to host mode (Edit Space → Container isolation → Switch back to host) to unblock yourself while iterating on the Dockerfile.

---

## When to use container mode

- Spaces whose repos run code you don't fully trust (third-party code, scraping, unsanitized input handlers).
- Spaces on laptops with sensitive credentials reachable from the host (SSH keys, AWS creds in `~/.aws/`, other repos with secrets).
- Spaces where the agent might run heavy compute that you want CPU-quotaed (docker-level `--cpus`, `--memory` flags can be added per-Space later).

## When NOT to use container mode

- Personal projects on a dev VM where the host is already isolated.
- Quick-iteration Spaces where the per-attempt image-build cost (~10-60s after first build, depending on layer cache) is a friction you don't want.
- Production Spaces if you haven't actually reviewed the generated Dockerfile yet. The HITL handoff is real — a misconfigured Dockerfile is worse than host mode for both speed and trust.
