# Jira Issues Resolver — v1 PRD

> Domain language for every bolded term in this document is defined in [`/CONTEXT.md`](../CONTEXT.md). Hard-to-reverse architectural decisions are recorded in [`docs/adr/`](./adr/). Read both before this PRD.

## Problem Statement

Engineers at Ongage spend a meaningful slice of every week on the mechanical parts of Jira-driven work: noticing a ticket is ready to pick up, creating a branch, reading the description, writing the code, testing it, opening a PR, and transitioning the ticket to code review. Many tickets are routine enough that this end-to-end loop is the bottleneck — not the engineering thinking. Reopened tickets compound the cost because the engineer has to re-acquire context from the prior PR's review comments and the Jira thread.

The team wants a way to drain the routine inflow automatically while keeping every code change reviewable by a human before it merges. They also need this to work across multiple team members' laptops, with different sensitivity profiles (some laptops have production secrets reachable from the host filesystem; some don't).

## Solution

A locally-installed web app called the **Jira Issues Resolver**. Each engineer installs it on their laptop and configures one or more **Spaces**. A Space ties a Jira filter (project + component/labels/fixVersion + statuses + agent labels) to a GitHub repository and an AI agent (Claude or Codex via the Sandcastle library).

When a Space's **Resolve Loop** is started, the app polls Jira on an interval. For each matching Jira issue with no in-flight **Resolve Attempt**, it creates a new attempt: clones (or reuses) the repo, sets up a **Worktree** for the issue branch, runs the agent with a prompt assembled from the issue description, comments, and (on reopen) prior PR review comments. The agent edits the code and commits inside the **Agent Runtime**. The orchestrator (outside the runtime) squashes the agent's commits to one, pushes to GitHub, opens a PR, and transitions the Jira issue to the configured target status (e.g. "Code Review").

Engineers can watch every attempt live as it happens through a streaming log panel per Space, browse the history of attempts per issue (each attempt is a separate row, so a reopened issue's full timeline is preserved), and start/stop the loop per Space without losing state. Sensitive laptops can flip a Space into **container Agent Runtime mode** for Docker-based isolation; others stay in the default **host mode** for speed.

## User Stories

### Setup & onboarding

1. As a new user, I want to install the app via Docker Compose with one command (`docker compose up` + `npm start`), so that I can be up and running on my laptop in under five minutes.
2. As a new user, I want the app to remind me when I haven't yet entered a global Jira API token, so that I don't try to create a Space prematurely.
3. As a new user, I want to enter my Jira email + API token once at the global level, so that all my Spaces inherit it.
4. As a user, I want the Jira credential validated synchronously when I save it (with a clear error if it's wrong), so that I trust the system from the first save.
5. As a user, I want to mint a Jira API token from a deep-link to `id.atlassian.com/manage-profile/security/api-tokens`, so that I don't have to hunt for the URL.

### Creating a Space

6. As a user, I want to create a new Space by entering: a name, a GitHub repo URL, a fine-grained GitHub PAT, my committer name + email, the base branch, the Jira project, a filter field (component / labels / fixVersion), a filter value, allowed Jira statuses, agent labels, and target Jira status — so that I have one place that ties "which Jira issues" to "which repo".
7. As a user, I want to pick which AI agent (Claude or Codex) and which model the Space uses, so that I can run cheaper models for routine Spaces and more capable ones for hard Spaces.
8. As a user, I want the agent model dropdown to default to Claude Opus 4.7, so that I get the most capable default without thinking.
9. As a user, I want to choose between "host" (default) and "container" agent runtime mode at Space creation, so that I can match isolation to the sensitivity of my laptop and the repo.
10. As a user picking container mode, I want the app to detect my repo's existing Dockerfile, merge in the Sandcastle agent layer, and show me the merged file in an editor before saving — so that I don't have to write a Dockerfile from scratch.
11. As a user picking container mode, I want the merged Dockerfile stored in the app's database (not committed to my repo), so that my repo stays clean and other teammates aren't affected.
12. As a user, I want every credential and the JQL filter validated synchronously at submit time (Jira `/myself`, GitHub `/repos/:o/:r`, JQL `search maxResults=0`, `git ls-remote`), so that I see errors before the Space is saved.
13. As a user, I want the repo clone deferred to first tick rather than blocking the Create Space form, so that I'm not waiting through a multi-minute clone in the form.
14. As a user, I want a "Verify repo" button on the Space detail page that triggers an immediate clone with progress feedback, so that I can confirm clone-ability on demand.
15. As a user, I want the loop to start in the OFF state when I create a Space, so that I have a chance to review my config before any agent runs.

### Loop control

16. As a user, I want a big Start button on each Space's detail page that turns the Resolve Loop on, so that I can begin draining.
17. As a user, I want a Stop button that halts the loop without losing the current state, so that I can pause for any reason (deploy freeze, model issues, vacation).
18. As a user, I want a "Tick now" button that triggers an immediate tick regardless of the auto-interval, so that I don't have to wait when I'm actively watching.
19. As a user, I want to set the tick interval per Space (default 5 minutes; allowed range 30s – 1h), so that hot Spaces can drain quickly and cold Spaces don't hammer Jira.
20. As a user, I want loops that were running when I shut down the server to auto-resume when I restart it, so that I don't have to manually restart every Space after a reboot.
21. As a user, I want any Resolve Attempt that was mid-flight when the server crashed to be marked FAILED on restart with a clear reason ("orphaned at boot"), so that the system never silently leaves a row claiming to be running.

### Watching attempts live

22. As a user on a Space's detail page, I want to see live streaming logs of the currently-running Resolve Attempt (every orchestrator step + every agent text chunk + every git/GitHub/Jira call), so that I can diagnose what the agent is doing in real time.
23. As a user, I want the live log to switch transparently when one attempt ends and the next begins, so that I don't have to refresh the page mid-drain.
24. As a user, I want the live log to show an "idle" state when no attempt is in flight, so that I know the page is alive but waiting.
25. As a user, I want the live log to be readable on a Pretty/Raw toggle so that I can see formatted events normally and raw NDJSON when I'm debugging.

### Resolve Attempts grid

26. As a user, I want each Space's detail page to list every Resolve Attempt (latest first), grouped by issue, so that I can see the full drain history at a glance.
27. As a user, I want to expand a Jira issue's row to see all prior attempts on that issue, so that I can trace a reopen back through its history.
28. As a user, I want each attempt row to show: issue key, current status (with the granular state if non-terminal), branch name, PR URL (if any), duration, started_at, attempt number.
29. As a user, I want to click a Resolve Attempt to open a dedicated page with its full historical log, so that I can post-mortem a failure without losing other Spaces' state.
30. As a user, I want the attempt detail page to show the prompt that was sent to the agent (post-ADF-rendering, with reopen context inlined), so that I can debug prompt-related issues.
31. As a user, I want a "Stop attempt" button on an in-flight attempt's page, so that I can cancel one that's clearly going wrong without stopping the whole Space's loop.

### Spaces grid (home)

32. As a user, I want a main grid of all Spaces on the home page, so that I have a single place to navigate from.
33. As a user, I want each Space card to show: name, repo URL, loop state (running/stopped), last tick time, count of attempts (today / total), count of failures (today / total).
34. As a user, I want to soft-delete a Space without losing its Resolve Attempt history, so that I can hide retired Spaces but still reference them if needed.

### Loop semantics

35. As a user, I want the loop to only create a new Resolve Attempt when no prior attempt for that `(Space, issue)` is in a non-terminal state, so that I never have two agents racing on the same issue.
36. As a user, I want FAILED attempts to be terminal — the loop will NOT auto-retry — so that I'm not silently burning tokens on a broken state.
37. As a user, I want to re-trigger a failed attempt by transitioning the Jira issue out of the matching status and back (or re-adding the agent label), so that the human signal is explicit.
38. As a user, I want the global concurrency cap (default 3 simultaneous agent runs across all Spaces) configurable, so that I can throttle expensive agent runs on a constrained laptop.

### Reopen handling

39. As a user, when a Jira issue I previously closed is reopened with the `reopen` label, I want the new Resolve Attempt to receive (a) the prior PR's review comments and (b) the Jira comments added after the prior attempt ended — automatically injected into the prompt — so that the agent addresses the actual feedback without me writing a prompt every time.
40. As a user, I want the new attempt on a reopen to commit on top of the existing remote branch (not start over from main), so that the PR continuity is preserved and reviewers see "additional commits since you reviewed".
41. As a user, I want each attempt's commit to start with the Jira issue key (`RND-1 Fix the search bug`) regardless of what the agent named the commit, so that conventions stay enforced.
42. As a user, I want each commit to include git trailers (`Resolve-Attempt: <uuid>`, optionally `Prior-Attempt: <uuid>`), so that the UI can link a commit back to its row in the database.

### Agent behavior

43. As a user, I want the agent to receive only the prompt I authorize (Jira issue + comments + reopen context if applicable) and never have my Jira/GitHub credentials in its sandbox, so that prompt injection cannot exfiltrate my tokens.
44. As a user, I want the agent's prompt to forbid push, PR open, and Jira transitions ("the server does those"), so that the agent's surface is just edit + commit.
45. As a user, I want the agent to commit at least one new commit, even if it's trivial — so that the orchestrator can detect "no changes" cleanly and mark FINISHED_NO_CHANGES rather than treating it as a failure.

### Jira transition

46. As a user, I want the Jira transition step to soft-fail when no valid transition exists from the current status to my target — meaning the attempt still reaches FINISHED with a warning rather than FAILED — so that an unrelated workflow change in Jira doesn't make my otherwise-successful PR look broken.
47. As a user, I want the transition warning surfaced in the attempt's status row in the UI so that I can spot and remediate manually.

### Credentials & at-rest security

48. As a user, I want all sensitive tokens (Jira API token, GitHub PATs) encrypted at rest with AES-256-GCM keyed by a master secret in my `.env`, so that a stolen DB file alone doesn't yield my secrets.
49. As a user, I want the master key auto-generated and written to `.env` on first boot if it doesn't exist, so that I'm not blocked by key bootstrap.

### Multi-laptop story

50. As a teammate getting handed this app, I want the install to be the same regardless of which laptop I'm on (`docker compose up` + `npm start`), so that the team's onboarding doesn't fork by machine.
51. As a teammate with a sensitive laptop, I want to opt my Spaces into container mode without changing the install or the codebase, so that "isolation" is a config decision, not a deployment decision.

### Edge cases & failure handling

52. As a user, I want git push to use `--force-with-lease` (never `--force`), so that I never overwrite work someone else pushed to the branch.
53. As a user, I want the orchestrator to attempt to clean up the worktree on FAILED so that disk doesn't fill with stale worktrees.
54. As a user, I want a 30-day retention sweeper that removes old NDJSON log files, so that the data directory doesn't grow unbounded.
55. As a user, I want the cleanup retention to be configurable in the global settings, so that I can tune for my disk.
56. As a user, I want a soft-delete flow for Resolve Attempts in terminal states (lets me hide noise without losing history), so that the UI stays usable as the Spaces age.

## Implementation Decisions

These are the locked architectural decisions from the design grilling. ADRs `0001`, `0002`, `0003` cover the three hardest-to-reverse / surprising ones in depth.

### Runtime & topology

- **Node.js 22 LTS** for the server. Sandcastle is a Node library; the ecosystem fits.
- **Server runs on the host**; only Postgres (and Sandcastle's bind-mount containers in container-mode Spaces) live in Docker. `docker compose up` brings up Postgres only.
- **Single Node process** for v1: API + per-Space async loops + log streaming all in one. State is persisted in Postgres so a future worker can be extracted without rewrites.
- **pnpm monorepo** with three workspaces: `server/`, `web/`, `shared/`.

### Domain model

- **Space**, **Resolve Attempt**, **Reopen** (situation, not a flag), **Resolve Loop**, **Tick**, **Agent Runtime**, **Agent Provider**, **Worktree**, **Base Branch**, **Target Status**, **Committer Identity** — all defined in CONTEXT.md.
- **One row per agent run** in `resolve_attempts`. Reopens spawn a new row with `prior_attempt_id` set. (ADR-0003)
- **Granular state machine**: `QUEUED → PREPARING_REPO → AGENT_RUNNING → CHECKING_COMMITS → PUSHING → OPENING_PR → TRANSITIONING_JIRA → FINISHED | FINISHED_NO_CHANGES | FAILED`. Any step → `FAILED` with `error_reason` + `stuck_at_status`.
- **Hybrid Agent Runtime** per Space: `host` (Sandcastle no-sandbox provider, default) or `container` (bind-mount provider with DB-stored Dockerfile). (ADR-0001)

### Concurrency

- **Serial per Space, parallel across Spaces**, with a global cap on simultaneous Sandcastle runs (default 3).
- Loops are async tasks held in a `Map<spaceId, Worker>`.

### Repo & branch model

- **One persistent clone per Space** at `data/repos/<spaceId>/`.
- **Worktree per attempt** at `data/repos/<spaceId>/wt/<issueKey>/`.
- **Reuse remote branch on reopen** (branch name = Jira issue key). If `origin/<issueKey>` exists → worktree tracks it, push `--force-with-lease`. Else → worktree off `origin/<baseBranch>`, push `-u`.
- **Base branch is per-Space** (`spaces.base_branch`, default `main`).

### Loop logic

- Each tick runs JQL: `project = $project AND $filter_field = $filter_value AND status IN $statuses AND labels IN $agent_labels`.
- For each matching issue with no in-flight Resolve Attempt: create a new attempt; `attempt_number = priors.length + 1`; `prior_attempt_id = last(priors)?.id`.
- **Reopen detection is implicit**: priors all terminal → fetch prior PR review comments + Jira comments since prior `ended_at`; inject both into the prompt.
- **FAILED is terminal**; no auto-retry. Human re-triggers via Jira (transition or relabel).

### Agent contract

- **Prompt-only context**, no external creds in the sandbox. Server fetches Jira description + comments + reopen context before launching the agent.
- Prompt forbids push, PR open, Jira transitions.
- **Agent provider + model per Space**: Claude (Opus 4.7 default / Sonnet 4.6 / Haiku 4.5) and Codex (model IDs confirmed at impl time). UI exposes both providers in v1.
- **Static prompt template, orchestrator amends**: agent commits with its own message; orchestrator squashes new commits to one and amends with `<ISSUE-KEY> <subject>\n\n<body>\n\nResolve-Attempt: <id>\nPrior-Attempt: <prior-id?>`.

### Integrations

- **Jira Cloud + API token**: single global credential (`settings.jira_email` + `settings.jira_api_token_enc`). REST v3. Basic auth (`base64(email:token)`).
- **GitHub fine-grained PAT per Space**: Octokit for PR ops, `GIT_ASKPASS` script for push (no token in URL/reflog). Per-Space committer name + email.
- **Filter field restricted** to `component | labels | fixVersion`. No custom-field support in v1.
- **Jira target status** per Space; runtime name→transition-ID resolve via `GET /issue/<key>/transitions`. Soft-fail (FINISHED with warning) if no matching transition.
- **ADF rendering** via library (e.g. `adf-to-md`); library picked at impl time after a smoke test on real Ongage tickets.
- **Sandcastle**: provider switched per attempt by Space's `agent_runtime_mode`. Worktree managed by orchestrator with `branchStrategy: 'head'`.

### Live logs

- **NDJSON file per attempt** at `data/logs/<attempt_id>.ndjson`. Every orchestrator step + Sandcastle `onAgentStreamEvent` chunk + git/GitHub/Jira call appends one line.
- **SSE via Hono's `streamSSE`** at `GET /api/spaces/:id/logs/stream`. Event types: `attempt_start | line | attempt_end | idle`.
- **Historical log read** at `GET /api/spaces/:id/resolve-attempts/:rid/logs` (plain text).
- **Retention sweeper** hourly; deletes NDJSON files with `ended_at` older than 30 days (configurable in global settings).
- **Orphan reconciliation on startup**: any attempt with non-terminal status at boot → `FAILED` with reason "orphaned at boot".

### Persistence

- **Postgres** (containerized via `docker compose`).
- **Raw SQL migrations** in `server/src/migrations/`, applied at startup against a `_migrations` tracking table.
- **Kysely** as the typed query builder. No ORM. Hand-written `Database` interface mirroring the schema.
- **AES-256-GCM** encryption at rest for token columns (`*_enc`); master key in `MASTER_KEY` env var, auto-generated on first boot if absent.

```sql
-- Tables (verbatim from grilling; see CONTEXT.md for column semantics)
settings (single row enforced via id = 1 CHECK)
  id, jira_email, jira_api_token_enc, created_at, updated_at

spaces (per-laptop, soft-deletable)
  id, name, github_repo_url, github_token_enc,
  github_committer_name, github_committer_email,
  base_branch, agent_provider, agent_model,
  agent_runtime_mode, dockerfile_content,
  jira_project, filter_field, filter_value,
  allowed_statuses, agent_labels, target_status_name,
  tick_interval_seconds, loop_running,
  deleted_at, created_at, updated_at

resolve_attempts (INSERT-only per agent run)
  id, space_id, issue_key, attempt_number, prior_attempt_id,
  status, branch_name, pr_url, pr_number,
  error_reason, stuck_at_status, transition_warning,
  log_file_path, started_at, ended_at
  UNIQUE (space_id, issue_key, attempt_number)
  INDEX (space_id, status), (space_id, issue_key, started_at), (ended_at)
```

### File structure

- `server/src/api.controller.ts` — single HTTP gateway, all routes here (ADR-0002).
- Per-domain folders: `settings/`, `spaces/`, `resolve-attempts/`, `resolve-loop/`, `orchestrator/`, `logs/`. Each has `<domain>.repository.ts` + `<domain>.service.ts` + `dto/` folder.
- `server/src/integrations/{jira,github,git,sandcastle}/` — clients only, no services.
- `web/` — React + Vite + Tailwind v4 + shadcn/ui (matches reference).
- `shared/` — types and DTOs consumed by both server and web.

### Module sketch (deep modules; see below for shallow glue)

| Deep module | Interface |
|---|---|
| Orchestrator | `runAttempt({ space, attempt }) → void` |
| Resolve Loop | `start(space) / stop(spaceId) / tickNow(spaceId) / resumeRunningLoops()` |
| Prompt Builder | `buildPrompt({ issue, comments, priorAttempts? }) → string` |
| Branch Resolver | `prepareWorktree({ space, issueKey }) → worktreePath` |
| Commit Finalizer | `finalize({ worktree, base, issueKey, attemptId, priorAttemptId? }) → { commits: 0 \| 1 }` |
| Dockerfile Generator | `generate({ repoPath }) → { content, detectedFrom }` |
| Sandcastle Runner | `run({ space, worktree, prompt, onEvent }) → void` |
| Jira Client | `searchJql / getIssue / getComments / listTransitions / transition` |
| GitHub Client | `getRepo / createPR / findPRByBranch / listPRReviewComments` |
| Git Client | `fetch / lsRemoteBranch / worktreeAdd / worktreeRemove / log / push` |
| Crypto | `encrypt(plain) → blob / decrypt(blob) → plain` |
| Log Tailer | `createTailer({ filePath, onLine }) → { start, stop }` |
| SSE Driver | `streamLogs(spaceId, stream) → void` |
| ADF Renderer | `renderToMarkdown(adf) → string` |

Shallow glue: per-domain repositories (Kysely wrappers), API Controller handlers, Migrations Runner, per-domain CRUD services, Config / Logger.

## Testing Decisions

### What makes a good test for this project

- **Test external behavior**, not implementation. The Branch Resolver's test should assert "given a remote branch `origin/RND-1`, the resulting worktree tracks it"; not "internal helper `resolveRefSpec` returns `refs/remotes/origin/RND-1`".
- **Prefer fixtures over mocks** for pure-data inputs (Jira issue payloads, ADF documents). Real shapes catch real bugs.
- **Use temp git repos** for Git-touching modules. `tmp` package or `os.tmpdir` + setup helper. Don't mock `git`; run it.
- **Mock HTTP at the boundary** for Jira/GitHub clients (via `undici`'s `MockAgent` or `msw/node`). Don't mock the client's internals.
- **No tests of state-machine glue that's already encoded as types**: a test that asserts `status: 'PUSHING'` exists is duplicative with the CHECK constraint and the TypeScript enum.

### Modules called out for v1 tests (the Core 4)

1. **Prompt Builder**
   - Snapshot tests against a fixture set: regular issue (no priors), reopen with prior FINISHED PR, reopen with multiple priors, issue with attachments mentioned in description, issue with code blocks in comments, issue whose ADF includes mentions / panels / tables.
   - Fixtures live under `server/src/orchestrator/__fixtures__/`.
   - Snapshots are checked into the repo; failures require explicit reapproval.

2. **Branch Resolver**
   - Tests run against a temp git repo with a controlled remote.
   - Cases: remote branch exists (reuse, worktree tracks it); remote branch absent (fresh, off baseBranch); remote moves between resolve attempts (force-with-lease push semantics); worktree cleanup after stop.

3. **Commit Finalizer**
   - Temp git repo with a known base.
   - Cases: zero new commits → `{ commits: 0 }`; one commit with the issue key already prefixed → reuse subject; one commit without prefix → prepend; N commits (3, 5, 10) → squash to one; agent left untracked files → not committed; agent's commit subject is empty → fall back to `<ISSUE-KEY> resolve attempt <number>`.
   - Verify trailers (`Resolve-Attempt:`, `Prior-Attempt:`) are git-trailer-compatible (machine-parseable).

4. **Crypto**
   - Round-trip: `decrypt(encrypt(plain)) === plain`.
   - Tamper detection: flipping a bit in the ciphertext, IV, or auth tag makes `decrypt` throw.
   - Key length validation: 31-byte and 33-byte keys are rejected at module load.

### Tests deferred past v1 (with reasoning)

- **Orchestrator**: most useful coverage, but biggest setup cost (mocked integrations + temp git repo + temp NDJSON path + temp DB). Once the Core 4 are anchored, add Orchestrator tests state-by-state as bugs surface.
- **Resolve Loop**: timing-sensitive; needs a fake clock helper. Add when concurrency bugs appear, not before.
- **Dockerfile Generator**: only matters in container mode; defer until container mode is exercised in anger.
- **ADF Renderer**: library has its own tests. Add a thin wrapper test only if specific Ongage ticket shapes fail rendering.
- **Jira / GitHub / Git Clients**: HTTP-mocking is shallow signal. Cover via integration scenarios in Orchestrator tests when those land.
- **Log Tailer / SSE Driver**: lifted verbatim from the reference (auto-bug-fixer), where they're battle-tested.

### Prior art

The reference repository [`boris-smetanin/auto-bug-fixer`](https://github.com/boris-smetanin/auto-bug-fixer) doesn't ship dedicated unit tests for its deep modules (it relies on manual exercise). Our Core 4 choice intentionally diverges from that — we anchor the four cheapest-to-test modules that also encode the most architecturally load-bearing logic (prompt assembly, branch model from ADR territory, commit finalization, security primitive).

## Out of Scope

Explicit non-goals for v1, to prevent scope creep:

- **Multi-tenant hosting.** Each user runs their own instance on their laptop. No shared deployment, no auth, no rate limiting per user.
- **Web auth.** The app is bound to `localhost` (or trusted internal network). No login screen.
- **Production deployment story.** v1 ships to laptops; production deployment is a future swap (container provider becomes mandatory, Postgres moves to managed, secrets move to KMS).
- **GitHub App** as a credential mechanism. Fine-grained PAT only in v1.
- **OAuth 2.0 for Jira.** Cloud + API token only.
- **Custom Jira fields** in the filter. Built-in allowlist (`component`, `labels`, `fixVersion`) only.
- **Raw JQL escape hatch.** All filtering is structured.
- **Auto-retry of FAILED attempts.** Human-only re-trigger.
- **Webhook ingestion from Jira.** Polling only.
- **Pluggable issue trackers.** Jira Cloud only.
- **Pluggable git hosts.** GitHub only.
- **Auto-merge after green CI.** PR creation and Jira transition are the orchestrator's last steps; merge is human.
- **Per-attempt cost / token usage tracking.** Useful but not in v1.
- **Slack / email notifications.** Out of scope; the UI is the dashboard.
- **Generic AI-agent abstraction beyond Sandcastle.** Sandcastle is the only orchestration layer; switching it would be a separate ADR.
- **Mobile UI.** Desktop browser only.

## Further Notes

- The reference implementation [`boris-smetanin/auto-bug-fixer`](https://github.com/boris-smetanin/auto-bug-fixer) is the closest template. Reuse patterns verbatim where they fit (Log Tailer, SSE driver shape, `markOrphanedAttempts`, `--force-with-lease`, ASKPASS scaffolding). Diverge where the design grilling explicitly diverged (per-agent-run rows ADR-0003, branch reuse on reopen, no-sandbox-vs-container hybrid ADR-0001, single api.controller.ts ADR-0002, Postgres vs SQLite, Sandcastle vs direct Claude Agent SDK).
- **Domain language is authoritative** — see `/CONTEXT.md`. If a future change introduces a term not in the glossary, the PR should update CONTEXT.md.
- **Codex model IDs need confirmation** at implementation time. The Sandcastle README example was `codex("gpt-5.4-mini")` but real model identifiers evolve; lock the dropdown values when first hitting the OpenAI side.
- **Hardening recommendations for host-mode runtime** (deferred but listed for future hardening): never inherit `MASTER_KEY` into the agent subprocess; strip ADF comments to a strict markdown subset before injecting; consider a dedicated non-privileged Unix user for the server process. These aren't v1-blocking but should be revisited before any sensitive deployment.
- **First-target Space**: Ongage's MA-DMS service (Jira project `RND`, component `MA-DMS`, repo TBD). The grilling's edge-case analysis assumed this shape.
- **Resumption checkpoint for future agents**: `CONTEXT.md` + the three ADRs + this PRD together form the complete pre-implementation spec. A future agent picking this up should read all five before writing any code.
