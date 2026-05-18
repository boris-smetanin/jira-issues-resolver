# Single `api.controller.ts` at the server root

The server is structured DDD-style — per-domain folders (`settings/`, `spaces/`, `resolve-attempts/`, `resolve-loop/`, `orchestrator/`, `logs/`, plus `integrations/{jira,github,git,sandcastle}/`), each holding `*.service.ts` files, a `*.repository.ts`, and a `dto/` folder of input shapes. The reference auto-bug-fixer (and most Hono/Express conventions) put controllers *next to* their domain — `spaces/spaces.controller.ts`, `logs/logs.controller.ts`, etc.

We don't. **All HTTP routes live in a single file: `server/src/api.controller.ts`.** Each handler is 5–10 lines: parse input → call exactly one service function → return.

Reasons this is deliberate, not an oversight:

- The HTTP surface is legible from one file. `grep -n "post('" api.controller.ts` shows every entry point into the system.
- It forces a discipline: services must expose typed DTOs at their boundary, because the controller can't reach inside a domain and pluck out HTTP-shaped objects. Domain internals stay private.
- It surfaces fan-in early. The controller imports services from every domain — an unavoidable star — but no other file has to.

The cost is real: `api.controller.ts` grows with feature count. With ~6 domains and 3–6 routes each, expect 100–300 lines steady-state. Acceptable; the file is intentionally dumb.

Hard to reverse because every handler would need to move to a per-domain controller file. Surprising because most TS engineers will assume the per-domain shape and try to "fix" this. That's what this ADR is for: please don't.
