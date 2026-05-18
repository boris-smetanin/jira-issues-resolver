# 0012 — Codex provider activation

## What to build

Activate the Codex/OpenAI agent provider end-to-end. The infrastructure to choose `agent_provider = 'codex'` exists from slice 0003 (CHECK constraint, dropdown), but no actual Codex factory call is wired and the model list is empty. This slice confirms the current Codex/GPT model IDs Sandcastle accepts, exposes them in the UI, and wires the runner.

Build:

- Verify the current Sandcastle Codex factory signature and supported model IDs:
  - Inspect the installed `@ai-hero/sandcastle` package's `codex` provider export and its accepted model strings.
  - Inspect the package's repo / README for current model recommendations.
  - Pick the set to expose in v1 (the README's `codex("gpt-5.4-mini")` was an example; current IDs may differ).
- Add an `OPENAI_API_KEY` slot to `settings` table (encrypted, like Jira token) — required when any Space uses Codex.
- Settings page gains an "OpenAI API key" field, validated by a small Codex factory smoke test (or just by length/prefix check if no cheap call is available).
- `agent_model` enum in `dto/create-space.dto.ts` extended with the confirmed Codex IDs; UI dropdown shows Claude models under a "Claude" optgroup and Codex models under an "OpenAI" optgroup.
- `integrations/sandcastle/sandcastle.runner.ts` extended:
  ```
  const agent = space.agent_provider === 'claude'
    ? claudeCode(space.agent_model)
    : codex(space.agent_model)
  ```
  Ensure the runner passes `OPENAI_API_KEY` to the agent's `env` (when `agent_provider === 'codex'`) via the Sandcastle `env` option — this is the one credential allowed in the sandbox.
- Update Create Space sync validation: if `agent_provider === 'codex'`, settings must have a non-empty `openai_api_key_enc`; reject with 400 if absent.

## Acceptance criteria

- [ ] Setting up a Codex-using Space requires the OpenAI key to be set in global settings first.
- [ ] Running an attempt on a Codex-using Space invokes `codex(...)` rather than `claudeCode(...)`. Verify by logging the resolved provider name in the orchestrator startup event.
- [ ] A Codex attempt produces the same orchestrator state-machine transitions and outputs as a Claude attempt; the agent's prose may differ but the orchestrator can't tell.
- [ ] If the Codex factory call throws synchronously (e.g. an invalid model ID), the attempt is FAILED with a clear `error_reason`.
- [ ] The `OPENAI_API_KEY` does NOT leak into Claude-using attempts' env (only passed when Codex is the provider).

## Blocked by

- 0006 — Push + PR open + Jira transition (full happy path)
