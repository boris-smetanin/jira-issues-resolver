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

// Slice 16b: code-improvement-shaped prompt. The defining characteristic
// is **observable behaviour does not change** — refactoring, perf,
// type-tightening, dep upgrades. This shape's discipline is the most
// rigorous of the three: preservation is the entire point.
//
// Discipline is inline (no skill in v1 pilot). The
// `depsInstalledHint` parameter is passed through to the universal
// constraints so the agent knows whether the orchestrator did/didn't
// install deps for this attempt.

export function buildCodeImprovementShapedPrompt(args: {
  issue: JiraIssue;
  split: CommentSplit;
  prior: PriorAttemptContext | undefined;
  depsInstalledHint: 'installed' | 'failed' | 'not-attempted';
}): string {
  const { issue, split, prior, depsInstalledHint } = args;
  const parts: string[] = [];

  // ── 1. SHAPE FRAMING ──────────────────────────────────────────────
  parts.push(`# Code improvement — Jira ${issue.issuetype || 'Task'} ${issue.key}`);
  parts.push('');
  parts.push(
    "You are improving code internals — refactoring, tightening types, cleaning up tech debt, or similar — without changing observable behaviour. Identical inputs MUST produce identical outputs after your changes.",
  );
  parts.push('');
  parts.push(
    'Failure modes we are explicitly trying to prevent: stealth behaviour change (the "refactor" alters what the code does); over-refactoring (touching more than the issue asks for); type widening to silence errors (`any`/`unknown` as a coping mechanism); removing "unused" code that wasn\'t actually unused; bulk renames or migrations beyond the requested scope; subtle API changes (added params, changed defaults, narrowed types).',
  );

  // ── 2. SHAPE-SPECIFIC DISCIPLINE ──────────────────────────────────
  parts.push('');
  parts.push('## Mandatory discipline — do not skip');
  parts.push('');
  parts.push(
    '**Step 1 — RESTATE THE BOUNDARY.** Before touching code, write down what IS being changed and what IS NOT — files, functions, modules in scope; everything else explicitly out of scope. If a `+hitl-to-agent+` Human directive specifies the refactor target or boundary, use it verbatim. If the description does not clearly bound the change, escalate — unbounded "code improvements" become rewrites.',
  );
  parts.push('');
  parts.push(
    '**Step 2 — PRESERVE OBSERVABLE BEHAVIOUR.** This is the entire point of this shape — apply it harder than in bug-shape or feature-shape work. Identical inputs MUST produce identical outputs. Public function signatures stay (or change explicitly per the issue). Error messages identical unless the issue says otherwise. If you cannot answer "what behaviour did I change?" with "none," you violated this rule.',
  );
  parts.push('');
  parts.push(
    '**Step 3 — NO ADJACENT CHANGES.** Touch only what is in the boundary you stated in step 1. If you see other code that "could be improved" while reading, note it in your commit message ("also noticed X, out of scope") but do NOT change it. Bulk renames are an anti-pattern.',
  );
  parts.push('');
  parts.push(
    '**Step 4 — PROVE PRESERVATION for each change.** For each modified function, pick 2-3 representative inputs and explicitly state the expected output before and after your change. They must be identical. For each removed line, state why it was safe to remove (where else was that behaviour preserved?). Write this reasoning into your final message (or into commit messages); do not commit blindly.',
  );
  parts.push('');
  parts.push(
    `**Step 5 — RUN THE STATIC CHECKER.** ${
      depsInstalledHint === 'installed'
        ? 'The orchestrator installed dependencies for you. The static checker IS runnable — run it (e.g. `npx tsc --noEmit`, `mypy <files>`, `vendor/bin/phpstan analyse <files>`) on your changes and fix any new errors before committing.'
        : depsInstalledHint === 'failed'
          ? 'The orchestrator attempted to install dependencies and the install FAILED. Fall back to read-based verification: Read every changed function\'s definition + grep for callsites + verify arg/return shapes match. This is step 4 extended into manual rigor; you cannot skip preservation arguments just because the checker isn\'t runnable.'
          : 'If the project\'s static checker is runnable in this worktree (look for `node_modules/`, `.venv/`, `vendor/`, `target/` — see the Universal Constraints section for commands), running it on your changes is STRONGLY preferred for this shape — it is the first line of defence against signature drift and stealth behaviour change. If it is NOT runnable, fall back to read-based verification with extra rigor (Read every changed function + grep callsites).'
    }`,
  );
  parts.push('');
  parts.push(
    'Commit the changes with a concise message that states the boundary you respected. If the requested change cannot be made without violating Step 2 (preservation), write `.jir/escalation.md` and make ZERO commits.',
  );

  // ── 3-7 (composed from shared blocks) ─────────────────────────────
  parts.push('');
  parts.push(...renderUniversalConstraints({ depsInstalledHint }));
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
