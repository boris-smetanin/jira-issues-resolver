# jira-issues-resolver

A locally-installed web app that drains a configured set of Jira issues by handing each one to an AI coding agent (Claude or Codex). For every matching issue it: branches off your repo, runs the agent inside a worktree, squashes the result into one commit, pushes, opens a pull request, and transitions the Jira issue to your "code review" status. You review the PR; you merge.

Each engineer runs their own copy on their own laptop. Nothing is shared between teammates.

---

## 1. Install

You need Docker Desktop (or any Docker + Compose v2 setup). Nothing else.

```sh
git clone https://github.com/<you>/jira-issues-resolver.git
cd jira-issues-resolver
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

Open <http://localhost:3000>.

The `.env` file is mostly empty on purpose — defaults work out of the box. A `MASTER_KEY` (used to encrypt your tokens at rest) is auto-generated on first boot and written back into `.env`. Keep that file; losing the key means losing the stored Jira / GitHub tokens.

If port 3000 is taken, change `WEB_PORT` in `.env` and restart.

---

## 2. First-run setup

Before you can create a Space, do these three things in the UI, in order.

### 2a. Connect Jira (Settings → Jira credentials)

- **Site URL** — `https://<your-company>.atlassian.net`
- **Email** — the Atlassian account email
- **API token** — mint one at <https://id.atlassian.com/manage-profile/security/api-tokens> (the Settings page links straight to it)

Save. The credential is validated against `GET /myself` before it's stored, so you'll know immediately if the token is wrong.

### 2b. Add an agent account (Agents page)

An "agent account" is a stored credential for an AI provider (Anthropic API key for Claude, OpenAI key for Codex). One account can be reused across many Spaces.

Add at least one. The provider determines which models are available when you create a Space.

### 2c. (Optional) Adjust the issue-type → prompt-shape map (Settings → Issue type → prompt shape)

The resolver uses three different prompt shapes depending on the issue type:

| Shape | Default issue types | What the prompt enforces |
|---|---|---|
| **Bug-shaped** | `Bug`, `Support` | Hypothesis-driven, root-cause discipline, "preserve behaviour you didn't intend to change" |
| **Code-improvement-shaped** | `Task`, `Change request` | Behaviour-preservation, refactor scope guardrails, dependency install before agent runs (so the static checker is real) |
| **Feature-shaped** | `Feature`, `New Feature`, `Customer Request` | Scope discipline, "don't over-engineer", interface-first, pattern-match existing code |

Each field is a comma-separated list of Jira issue-type names. Edit only if your Jira project uses different names (e.g. `Defect` instead of `Bug`). The resolver only picks up issues whose `issuetype` appears in one of these three lists — anything else is filtered out at the JQL level, so you never spend tokens on an issue type the agent doesn't know how to handle.

Lookup is case-insensitive.

---

## 3. Create a Space

A **Space** is one Jira filter glued to one GitHub repo glued to one agent. You can have many Spaces (one per service / project / team).

Click **+ New Space** on the home page. The form has four sections:

### Jira filter

| Field | What it does |
|---|---|
| **Project key** | The uppercase Jira project prefix, e.g. `RND`. |
| **Filter field** | One of `component`, `labels`, `fixVersion`. The resolver only supports this allowlist. |
| **Filter value** | The component / label / fixVersion to match (e.g. `MA-DMS`, `agent-eligible`, `2026.06`). |
| **Allowed statuses** | Comma-separated Jira status names. Only issues currently in one of these statuses are eligible. Examples: `Open, Reopened, Backlog`. |
| **Agent labels** | Comma-separated Jira labels. The issue must carry **at least one** of these to be picked up. Defaults: `queued, reopen`. |
| **Target status** | The status the resolver transitions the issue into after the PR opens. Default: `Code Review`. |

Together those become this JQL, run on every tick:

```
project = <project>
  AND <filter_field> = <filter_value>
  AND status IN (<allowed_statuses>)
  AND labels IN (<agent_labels>)
  AND issuetype IN (<all configured prompt-shape types>)
  AND labels NOT IN (agent-escalated)
```

### GitHub

| Field | What it does |
|---|---|
| **Repo URL** | HTTPS only: `https://github.com/owner/repo`. |
| **Personal Access Token** | A **fine-grained** PAT scoped to this repo. Needs `Contents: read & write`, `Pull requests: read & write`, `Metadata: read`. |
| **Committer name** / **email** | Stamped on every commit the agent makes. The email must be a verified address on the GitHub account that owns the PAT — otherwise commits appear "unlinked" on PRs. |
| **Base branch** | What new issue branches are cut from. Default `main`. |

### Agent

Pick the **account** you added in step 2b and the **model** (e.g. `claude-opus-4-7`, `claude-sonnet-4-6`).

### Loop

**Tick interval** — how often the resolver polls Jira for this Space. Default 300 s (5 min). Range 30 s – 1 h. Hot Spaces (active backlog) can go lower; cold Spaces should stay high to avoid hammering Jira.

Submit. Everything is validated synchronously — bad PAT, bad JQL, repo not clonable — so you see errors before the Space saves. The Space starts in the **OFF** state; nothing happens until you press **Start**.

---

## 4. The workflow: how an issue gets picked up

A Space's **Resolve Loop** runs one **Tick** per interval. On each tick it runs the JQL above and, for every matching issue with no in-flight attempt, creates a **Resolve Attempt**.

The lifecycle of one attempt:

```
QUEUED
  → PREPARING_REPO       (worktree set up off base branch, or off existing remote branch on reopen)
  → AGENT_RUNNING        (the LLM is editing files + committing inside the worktree)
  → CHECKING_COMMITS     (orchestrator inspects what the agent did)
  → PUSHING              (force-with-lease push to GitHub)
  → OPENING_PR           (PR opened against the base branch)
  → TRANSITIONING_JIRA   (issue moved into the target status)
  → FINISHED ■
```

Terminal alternatives:

- **FINISHED_NO_CHANGES** — agent ran cleanly but produced zero commits (it decided nothing needed changing).
- **ESCALATED** — agent decided it can't safely commit and wrote `.jir/escalation.md`. The resolver posts the write-up as a Jira comment and adds the `agent-escalated` label; the loop won't re-pick the issue until you remove that label.
- **FAILED** — error at any step. `error_reason` and the step it died at are stored. **The loop will not auto-retry.**

### How to re-trigger an issue

Because FAILED and ESCALATED are terminal, re-running an issue is always a deliberate human action:

- **Reopen flow** — your reviewer leaves PR comments, you transition the Jira issue back into one of your allowed statuses and (re-)add the `reopen` label. On the next tick the resolver creates a **new** attempt with `prior_attempt_id` pointing at the previous one. That new attempt automatically pulls in (a) the prior PR's review comments and (b) any Jira comments added after the previous attempt ended, and injects them into the agent's prompt. It commits on top of the existing branch (no force-from-scratch).
- **Retry a FAILED** — fix whatever was broken (bad config, missing token, etc.), then transition the issue out of and back into an allowed status, or remove + re-add an agent label. The status / label change is the explicit human signal that "yes, try again."
- **Escalation review** — read the agent's write-up in the Jira comment, decide what to do, then **manually remove the `agent-escalated` label** to make the issue eligible again.

### Per-Space concurrency

- **Serial within a Space** — at most one attempt runs at a time per Space, so two attempts in the same repo never race on the worktree or git plumbing.
- **Parallel across Spaces** — different Spaces run independently, bounded by a global cap (default: 3 simultaneous agent runs across the whole app).

---

## 5. The HITL comment — handing investigation to the agent

A **HITL comment** ("Human-In-The-Loop") is a Jira comment whose body contains the literal marker:

```
+hitl-to-agent+
```

Case-insensitive, anywhere in the body. It tells the resolver "this comment is privileged context — weight it as my own prior investigation, not just background chatter."

How each prompt shape treats it:

| Shape | HITL becomes |
|---|---|
| **Bug-shaped** | Hypothesis #1. The agent still has to investigate ≥2 alternative hypotheses, but yours starts at the top. |
| **Code-improvement-shaped** | The canonical scope / boundary for the refactor. |
| **Feature-shaped** | The canonical design choice / approach. |

Rules:

- **All HITL comments are always included**, never truncated, in chronological order (oldest → newest). Multiple developers can add multiple HITL comments; the agent sees all of them.
- Regular (non-HITL) comments are capped at the 5 most recent.
- Anyone with Jira comment-write permission on the issue can flag a comment HITL. No special role required.

Example:

> +hitl-to-agent+
> I looked at this — the regression started in v2026.04. The `OrderSummary` component used to memoise on `cart.id` and now memoises on the whole `cart` object. That re-renders on every quantity change. Fix: revert the memo key, don't try to "fix" the equality check.

That whole comment lands in the prompt under a `## Human directives — follow these` block, after the issue description and before any reopen context.

---

## 6. Watching attempts and managing history

- **Home page** — grid of all Spaces with loop state, last tick time, attempt counts.
- **Space detail page** — live streaming log of the currently-running attempt + a grouped list of attempts per Jira issue. Buttons: **Start** / **Stop loop**, **Tick now**, **Stop attempt** (only on a running row), **Delete** (only on a terminal row — soft-hide, doesn't lose history).
- **Attempt detail page** — historical log replay, the exact prompt that was sent to the agent (with HITL + reopen context inlined), PR link, error reason if any. Same Stop / Delete buttons.

Logs are stored as NDJSON files under `data/logs/<attempt-id>.ndjson`. An hourly retention sweeper deletes files older than the configured cutoff (default 30 days, editable in Settings → Log retention) — the attempt history row stays, the log tab just shows *(logs expired)*.

---

## 7. Docker — what's actually running

The recommended setup (the install command in §1) brings up two containers:

- **`app`** — single Node 22 process. Serves the React SPA, the `/api/*` HTTP routes, runs every Space's Resolve Loop, and shells out to the agent. Port `3000`.
- **`postgres`** — Postgres 16 with a healthcheck. Port `5433` on the host (`5432` inside the network), so it won't collide with a local Postgres on `5432`. Data persists in the `jir-postgres` named volume.

A `jir-data` volume is mounted at `/data` inside `app`. That's where per-Space repo clones, per-attempt worktrees, and NDJSON log files live. A bind mount of `/var/run/docker.sock` is included so Spaces opted into container Agent Runtime mode can launch sibling agent containers.

To **stop**: `docker compose -f docker-compose.yml -f docker-compose.prod.yml down`. Add `-v` to also wipe the database and data volume — don't do this casually; you'll lose every Space and every attempt history row.

To **upgrade**: `git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build`. Migrations run automatically on boot.

---

## 8. Security model — what stays on your laptop

- Jira API token, GitHub PATs, and agent provider keys are stored in Postgres, encrypted at rest with AES-256-GCM keyed by the `MASTER_KEY` in your `.env`. Stolen DB dump alone yields nothing.
- The agent process never sees your Jira or GitHub credentials. The orchestrator fetches the issue, builds the prompt, hands the agent only the prompt + a worktree. Pushing, PR opening, and Jira transitions all happen outside the agent's sandbox.
- The app binds to localhost. There is no auth screen; don't expose port 3000 to anything but your loopback.
- For sensitive repos, flip a Space into **container Agent Runtime mode** at create time. The agent then runs in an isolated Docker container built from a per-Space Dockerfile (merged from your repo's own Dockerfile + the Sandcastle agent layer), not as a host subprocess.

---

## For contributors

If you're modifying the app itself (not just using it), see:

- [docs/prd.md](docs/prd.md) — the product spec and locked architectural decisions.
- [CONTEXT.md](CONTEXT.md) — domain language (Space, Resolve Attempt, Tick, etc.). Use these terms in code and PRs; avoid the variants under `_Avoid_`.
- [docs/adr/](docs/adr/) — deliberate architectural decisions. Read before "fixing" anything structurally unusual.
- [docs/issues/](docs/issues/) — per-slice specs.
- [CLAUDE.md](CLAUDE.md) — conventions for Claude Code in this repo.

Dev modes:

```sh
# Dev in Docker (default compose, HMR via bind-mount + tsx watch / vite)
docker compose up --build
# UI :3000, API :3001, Postgres :5433

# Native dev (only Postgres in Docker)
docker compose up postgres -d
pnpm install
pnpm --filter @jir/server dev   # API :3001
pnpm --filter @jir/web dev      # UI :3000
```
