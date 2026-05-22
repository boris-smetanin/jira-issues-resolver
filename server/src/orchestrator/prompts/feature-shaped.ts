import type { JiraIssue } from '../../integrations/jira/jira.client.js';
import type { CommentSplit } from '../comments.js';
import {
  renderClosing,
  renderHitlBlock,
  renderIssuePayload,
  renderReopenBlock,
  renderUniversalConstraints,
  type PriorAttemptContext,
} from './shared.js';

// Slice 16b: feature-shaped prompt. Discipline is inline (no skill in
// v1 pilot — only bug-shape gets the skill mechanism).
//
// Failure modes this shape is disciplining against (LLM tendency on
// feature requests): over-engineering, scope creep, pattern violation,
// premature abstraction, skipping the spec.

export function buildFeatureShapedPrompt(args: {
  issue: JiraIssue;
  split: CommentSplit;
  prior: PriorAttemptContext | undefined;
}): string {
  const { issue, split, prior } = args;
  const parts: string[] = [];

  // ── 1. SHAPE FRAMING ──────────────────────────────────────────────
  parts.push(`# Feature implementation — Jira ${issue.issuetype || 'Feature'} ${issue.key}`);
  parts.push('');
  parts.push(
    "You are implementing a feature described in the Jira issue below. Your job is to deliver what the issue asks for — no more, no less — in a way that matches this codebase's existing patterns and preserves existing behaviour.",
  );
  parts.push('');
  parts.push(
    'Failure modes we are explicitly trying to prevent: over-engineering (building flexibility the spec did not ask for); scope creep (touching unrelated code "while I\'m here"); pattern violation (writing the feature in a style alien to surrounding code); premature abstraction; ignoring the literal requirement in favour of your interpretation.',
  );

  // ── 2. SHAPE-SPECIFIC DISCIPLINE ──────────────────────────────────
  parts.push('');
  parts.push('## Mandatory discipline — do not skip');
  parts.push('');
  parts.push(
    '**Step 1 — RESTATE THE SCOPE.** Before touching code, write down what this issue asks for as an explicit list of deliverables. If a `+hitl-to-agent+` Human directive specifies the approach or constraints, the deliverables list MUST honour them. If the description is too vague to enumerate deliverables (no acceptance criteria, no example, no "done when"), escalate — do NOT invent scope.',
  );
  parts.push('');
  parts.push(
    '**Step 2 — FIND ANALOGOUS CODE & READ THE CONVENTIONS.** Read 1-2 existing features that solve a similar problem in this codebase. Read `CONTEXT.md`, `CLAUDE.md`, `AGENT.md`, and `README.md` at the repo root if any of them exist. Mirror their structure: file layout, naming, error handling, state management. Do NOT import a new framework or library if existing tooling already expresses what you need.',
  );
  parts.push('');
  parts.push(
    '**Step 3 — SKETCH THE INTERFACE BEFORE INTERNALS.** For UI: what does the user see/click/type? For API: what\'s the route + request/response shape? For library: what\'s the exported function signature? Write this down as the first thing you implement (in a comment block, a stub function, or just inline in your reasoning) before filling in internals.',
  );
  parts.push('');
  parts.push(
    '**Step 4 — WRITE CONCRETE CODE.** Three similar lines beats a premature abstraction. Do NOT introduce a new interface, factory, or strategy pattern unless the deliverables list explicitly requires variation. If a future variation MIGHT happen, that is not enough.',
  );
  parts.push('');
  parts.push(
    '**Step 5 — PRESERVE EXISTING BEHAVIOUR.** The feature is additive. Tests that passed before MUST pass after. Routes that returned X for input Y MUST still return X. If your implementation requires changing existing behaviour, that is a separate concern — flag it in your commit message but do NOT bundle silently.',
  );
  parts.push('');
  parts.push(
    'Commit the feature with a concise message. If the deliverables list cannot be honoured safely (ambiguous spec that resists clarification by reading the codebase; existing behaviour would have to change in ways the issue does not authorise), write `.jir/escalation.md` and make ZERO commits.',
  );

  // ── 3-7 (composed from shared blocks) ─────────────────────────────
  parts.push('');
  parts.push(...renderUniversalConstraints({ depsInstalledHint: 'not-attempted' }));
  parts.push('');
  parts.push(...renderHitlBlock(split));
  parts.push('');
  parts.push(...renderIssuePayload({ issue, split }));
  parts.push('');
  parts.push(...renderReopenBlock(prior));
  parts.push('');
  parts.push(...renderClosing({ issueKey: issue.key }));

  return parts.filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');
}
