# Implementation issues — v1

Generated from the design grilling on 2026-05-18 via the `/to-issues` skill. Each issue is a tracer-bullet vertical slice that cuts through every architectural layer that exists when it lands. Pick them up in dependency order.

Anchor docs:
- [PRD](../prd.md)
- [Domain language](../../CONTEXT.md)
- [ADR-0001 — Hybrid agent runtime](../adr/0001-hybrid-agent-runtime.md)
- [ADR-0002 — Single api.controller](../adr/0002-single-api-controller.md)
- [ADR-0003 — Per-agent-run resolve attempts](../adr/0003-per-agent-run-resolve-attempts.md)

## Dependency graph

```
0001 ── 0002 ── 0003 ── 0004 ── 0005 ─┬── 0006 ─┬── 0007 ── 0010 ── 0015
                                       │         ├── 0008
                                       │         ├── 0009
                                       │         ├── 0012
                                       │         └── 0014 (← 0007)
                                       ├── 0011 (HITL)
                                       └── 0013
```

## Slice list

Published to GitHub on 2026-05-18 (slice number == issue number).

| # | GH | Title | Type | Blocked by | File |
|---|---|---|---|---|---|
| 0001 | [#1](https://github.com/boris-smetanin/jira-issues-resolver/issues/1) | Project scaffold + empty Spaces grid | AFK | — | [0001-project-scaffold.md](./0001-project-scaffold.md) |
| 0002 | [#2](https://github.com/boris-smetanin/jira-issues-resolver/issues/2) | Global Jira settings + Crypto module | AFK | #1 | [0002-jira-settings-crypto.md](./0002-jira-settings-crypto.md) |
| 0003 | [#3](https://github.com/boris-smetanin/jira-issues-resolver/issues/3) | Create Space form + sync validation | AFK | #2 | [0003-create-space-form.md](./0003-create-space-form.md) |
| 0004 | [#4](https://github.com/boris-smetanin/jira-issues-resolver/issues/4) | Tick-now → empty Resolve Attempt → FINISHED_NO_CHANGES | AFK | #3 | [0004-tick-now-skeleton.md](./0004-tick-now-skeleton.md) |
| 0005 | [#5](https://github.com/boris-smetanin/jira-issues-resolver/issues/5) | First real tick: agent runs locally, no push | AFK | #4 | [0005-agent-runs-locally.md](./0005-agent-runs-locally.md) |
| 0006 | [#6](https://github.com/boris-smetanin/jira-issues-resolver/issues/6) | Push + PR open + Jira transition (full happy path) | AFK | #5 | [0006-push-pr-transition.md](./0006-push-pr-transition.md) |
| 0007 | [#7](https://github.com/boris-smetanin/jira-issues-resolver/issues/7) | Live logs (NDJSON + Tailer + SSE + UI panel) | AFK | #5 | [0007-live-logs.md](./0007-live-logs.md) |
| 0008 | [#8](https://github.com/boris-smetanin/jira-issues-resolver/issues/8) | Resolve Loop scheduler + orphan reconciliation | AFK | #6 | [0008-resolve-loop-scheduler.md](./0008-resolve-loop-scheduler.md) |
| 0009 | [#9](https://github.com/boris-smetanin/jira-issues-resolver/issues/9) | Reopen context injection | AFK | #6 | [0009-reopen-context.md](./0009-reopen-context.md) |
| 0010 | [#10](https://github.com/boris-smetanin/jira-issues-resolver/issues/10) | Attempt history UI + per-attempt detail page | AFK | #7 | [0010-attempt-history-ui.md](./0010-attempt-history-ui.md) |
| 0011 | [#11](https://github.com/boris-smetanin/jira-issues-resolver/issues/11) | Container Agent Runtime mode | **HITL** | #5 | [0011-container-runtime-mode.md](./0011-container-runtime-mode.md) |
| 0012 | [#12](https://github.com/boris-smetanin/jira-issues-resolver/issues/12) | Codex provider activation | AFK | #6 | [0012-codex-provider.md](./0012-codex-provider.md) |
| 0013 | [#13](https://github.com/boris-smetanin/jira-issues-resolver/issues/13) | Tests for the Core 4 | AFK | #5 | [0013-core-four-tests.md](./0013-core-four-tests.md) |
| 0014 | [#14](https://github.com/boris-smetanin/jira-issues-resolver/issues/14) | Log retention sweeper + configurable retention | AFK | #7 | [0014-log-retention-sweeper.md](./0014-log-retention-sweeper.md) |
| 0015 | [#15](https://github.com/boris-smetanin/jira-issues-resolver/issues/15) | Polish: soft-deletes + stop-attempt button | AFK | #10 | [0015-polish-soft-deletes-stop-attempt.md](./0015-polish-soft-deletes-stop-attempt.md) |

## Parallelizable groups

After 0006 lands, these can run in parallel by separate people:
- 0007 (live logs)
- 0008 (loop scheduler)
- 0009 (reopen)
- 0012 (codex)
- 0013 (Core 4 tests — can start as soon as 0005 lands)

After 0007 lands:
- 0010 (history UI)
- 0014 (retention sweeper)

0011 (container mode) and 0015 (polish) are the deferred tail.

## Publishing status

Published to GitHub on 2026-05-18 via the `/to-issues` skill. AFK slices carry the `ready-for-agent` label; slice 0011 carries `hitl`. Slice number maps 1:1 to issue number, so the dependency graph above can be read as either.
