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

// Slice 16b: bug-shaped prompt. The actual hypothesis discipline lives
// in a `/diagnose` skill (markdown at /home/agent/.claude/skills/diagnose
// and /home/agent/.agents/skills/diagnose — same content, both Claude
// and Codex pick it up). The prompt's job is to (a) frame the work as
// a bug, (b) tell the agent to invoke the skill, (c) wire in the HITL,
// payload, reopen and closing sections.
//
// Pilot: only bug-shape gets a skill in v1. If it measurably outperforms
// inline discipline (better hypothesis quality, fewer reopens),
// generalise to `/scope-feature` and `/preserve-code-improvement`.

export function buildBugShapedPrompt(args: {
  issue: JiraIssue;
  split: CommentSplit;
  prior: PriorAttemptContext | undefined;
}): string {
  const { issue, split, prior } = args;
  const parts: string[] = [];

  // ── 1. SHAPE FRAMING ──────────────────────────────────────────────
  parts.push(`# Bug fix — Jira ${issue.issuetype || 'Bug'} ${issue.key}`);
  parts.push('');
  parts.push(
    "You are fixing a bug described in the Jira issue below. Your job is to identify the ROOT CAUSE and ship a focused fix that preserves intended behaviour. The fix must change what the reporter described as broken.",
  );
  parts.push('');
  parts.push(
    'Failure modes we are explicitly trying to prevent: surface-level patches that compile and look plausible but miss the root cause; symptom-swallowing workarounds (try/catch + ignore, deleting the failing check); over-broad rewrites unrelated to this bug.',
  );

  // ── 2. SHAPE-SPECIFIC DISCIPLINE ──────────────────────────────────
  parts.push('');
  parts.push('## Mandatory discipline — do not skip');
  parts.push('');
  parts.push(
    '**Step 1.** Before any code change, invoke the `/diagnose` skill and apply its discipline (hypotheses, preservation rule, verification step, escalation contract). The skill body is the source of truth for this shape — read it and follow it. If a `+hitl-to-agent+` Human directive is present in this prompt, the human has already started investigating and given you a steer; the discipline treats that as hypothesis #1, with ≥2 alternatives still required.',
  );
  parts.push('');
  parts.push(
    '**Step 2.** After `/diagnose` produces a verified top hypothesis, make the smallest fix that resolves it WHILE preserving intended behaviour. "Smallest" means smallest surface area — NOT smallest line count. A +50-line refactor that preserves intent is smaller than a -1-line deletion of the check producing the error.',
  );
  parts.push('');
  parts.push(
    '**Step 3.** Commit the fix with a concise message. Do not push, do not open a PR — the orchestrator handles those. If `/diagnose` concluded the right fix requires architectural changes too large for a single Jira-issue patch, OR root cause is outside this repo, write `.jir/escalation.md` and make ZERO commits (the orchestrator detects the file and routes to the human-input path).',
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
