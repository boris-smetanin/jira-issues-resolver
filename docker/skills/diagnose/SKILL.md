---
name: diagnose
description: Use this skill at the START of any bug-fix work in a Jira-issues-resolver Resolve Attempt. The skill walks through hypotheses, preservation rule, verification, and the escalation contract. Invoke before any code change. Applies to issuetype Bug or Support (anything that mapped to the bug-shaped prompt).
---

# /diagnose

You are diagnosing a bug described in a Jira issue. This skill enforces the discipline that prevents the failure modes we see most often: surface-level patches that compile and look plausible but miss the root cause; symptom-swallowing workarounds; over-broad rewrites unrelated to the bug.

## Step 1 — Hypotheses (minimum 3)

State at least **3 ranked, falsifiable hypotheses** about what causes the symptom described in the issue. Each must include the prediction:

> "If `<X>` is the cause, then `<change Y>` will make the described behaviour stop occurring."

A hypothesis whose change would NOT alter the visible failure is not a hypothesis — discard or sharpen it.

**If a `+hitl-to-agent+` Human directive in the prompt identifies a suspected root cause, hypothesis #1 MUST be that hypothesis.** The human has already started investigating; respect their work as the lead theory. You still must form ≥2 alternative hypotheses — humans miss too, and the discipline of considering alternatives is what catches errors in their initial diagnosis.

If the description is too sparse for ≥3 distinct hypotheses (no error messages, no repro, no log lines, no clear symptom), escalate — write `.jir/escalation.md` with what you can infer and ask for clarification. Do not fudge weak hypotheses to clear the floor.

## Step 2 — Verify the top hypothesis by reading

Confirm the top hypothesis by reading the code (Read, Grep, read-only Bash). Trace from the described symptom to the proposed cause. Confirm the prediction holds.

If you cannot confirm without running the code, say so and move to the next hypothesis. Do NOT run the project's test suite. Do NOT install dependencies.

Sometimes the right verification step is reading the `+hitl-to-agent+` comment again — humans often paste in their reasoning explicitly. Use that.

## Step 3 — Make the smallest fix that resolves the verified hypothesis

"Smallest" means **smallest surface area while preserving what the code was trying to do** — NOT smallest line count. A +50-line refactor that preserves behaviour is smaller than a -1-line deletion that removes the check producing the error.

Do not touch unrelated code.

## Step 4 — PRESERVATION RULE

A fix MUST preserve what the code was trying to do. Removing functionality to silence the symptom is a workaround, NOT a fix. Examples that violate this rule:

- Deleting a health check, monitor, or guard because it occasionally fails
- Wrapping a problematic call in `try/catch` and swallowing/discarding the error
- Deleting a failing test instead of fixing what the test was exercising
- Replacing a real operation with a no-op or always-skip feature flag

If your top hypothesis points at one of these as the fix, **the hypothesis is still wrong** — go deeper to find the underlying defect. A "minimal fix" of -1 line that removes the thing producing the error is never the right answer; +50 lines that refactor it so intended behaviour survives while the bug goes away IS the right answer.

If the correct fix requires architectural changes too large for a single Jira-issue patch AND the only LOC-minimal fix would be a workaround — **escalate**, do not commit a workaround.

## Step 5 — Verify the implementation

Before committing, verify what you actually changed, not just the cause:

- If the project's static checker is already runnable in this worktree (deps present in `node_modules/`, `.venv/`, `vendor/`, `target/`, etc.), run it on the edited files. Fix any new errors before committing.
- If the checker is NOT runnable (deps missing, no checker configured), **Read** the definition of every function you called or changed in your edit and verify:
  - Argument count + shape match the callee's signature
  - Return-type usage matches what the callee returns
  - Imports resolve to the right symbols

This is Step 2 (verify hypothesis by reading) extended one step to the new code you wrote — same tools, same discipline. Skipping this step because "deps aren't installed" is the wrong outcome.

Do NOT run the project's test suite — only static checks or read-based verification.

## Escalation contract

You CANNOT safely commit a fix from here in two cases:

**Case A — Root cause is OUTSIDE this repository.** The local call site is correct; the failure originates in an external service, a 3rd-party API, or a different repo. You verified this in Step 2.

**Case B — Root cause IS in this repository, but the correct fix requires architectural changes too large for a single Jira-issue patch**, and the only LOC-minimal alternative would violate the Preservation Rule.

In either case:

1. Write `.jir/escalation.md` containing:
   - The hypotheses you investigated and why each was ruled out
   - Which case applies (A or B), with evidence
   - For case A: which service/team/repo you suspect
   - For case B: the proposed refactor in enough detail for a human to act on it, plus why each workaround-sized alternative violates the Preservation Rule
2. Make **ZERO commits**. The orchestrator detects `.jir/escalation.md` and routes the attempt to the human-input path (status `ESCALATED`, Jira comment posted, `agent-escalated` label added).

Escalation is the CORRECT outcome when the local code is doing the right thing OR when the correct fix is too large to ship safely as a Jira-issue patch. Fabricating a "fix" or shipping a workaround to avoid escalation is the WRONG outcome.

## Constraints (mirror of the prompt's Universal Constraints)

- Do NOT run the project's test suite.
- Do NOT install dependencies.
- Do NOT push. Do NOT open a PR. The orchestrator handles those.
- When the fix is ready, commit it via git from the Bash tool with a concise message.
