# Per-agent-run Resolve Attempt rows with granular states

The reference auto-bug-fixer uses `UNIQUE(space_id, sentry_issue_id)` and mutates one row in place across retries. Sentry's model fits that — issues are unique events, mostly fixed once. Jira's is different: the *same* issue gets reopened over its lifetime, sometimes multiple times, and each new attempt depends on context from the prior one (PR review comments, Jira comments added since the prior attempt ended).

We chose to make `resolve_attempts` **INSERT-only per agent run**. Each row represents one attempt to resolve one Jira issue once:

- `UNIQUE (space_id, issue_key, attempt_number)` — `attempt_number` increments per `(space, issue)`
- `prior_attempt_id` links back to the previous attempt in the chain (null on the first)
- Status flows through ten granular states (`QUEUED → PREPARING_REPO → AGENT_RUNNING → CHECKING_COMMITS → PUSHING → OPENING_PR → TRANSITIONING_JIRA → FINISHED | FINISHED_NO_CHANGES | FAILED`)

The mutate-in-place alternative (with a `retry_count` counter + a sibling `attempt_history` table for archived snapshots) was considered side-by-side and rejected because:

- **Reopen-context fetch is a single column read** on the prior row in this model. In mutate-in-place it requires joining the history table — and forgetting to snapshot before mutating silently loses data.
- **Orphan reconciliation on startup** (`UPDATE WHERE status NOT IN terminal`) hits exactly the in-flight rows. In mutate-in-place it hits the current row but has to be careful not to clobber a snapshot that's about to be taken.
- **The "specific resolve attempt page" UI** is naturally one URL per row; the live-log NDJSON file (`data/logs/<attempt_id>.ndjson`) keys off it; the orchestrator's state machine treats each row as one immutable run.

Scale isn't a concern — ~1.3 attempts per issue × hundreds of issues = single-digit thousands of rows over a year per Space.

Hard to reverse because the UI, the NDJSON file naming, the prompt-builder's reopen-context fetch, and the state machine all assume per-row immutability. Surprising vs the reference because someone reading auto-bug-fixer first will expect mutate-in-place. This ADR records the trade-off so the reasoning isn't lost.
