import { adfToMarkdown } from '../../integrations/adf/adf.formatter.js';
import type { PRComment } from '../../integrations/github/github.client.js';
import type { JiraIssue } from '../../integrations/jira/jira.client.js';
import type { CommentSplit } from '../comments.js';

// Slice 16b: shared prompt building blocks used by all three per-shape
// builders. Each per-shape builder composes these in the canonical
// section order (see CONTEXT.md > Prompt shape):
//
//   1. SHAPE FRAMING        ── owned by the per-shape builder
//   2. SHAPE DISCIPLINE     ── owned by the per-shape builder
//   3. UNIVERSAL CONSTRAINTS ── renderUniversalConstraints (this file)
//   4. HITL DIRECTIVES      ── renderHitlBlock (this file)
//   5. ISSUE PAYLOAD        ── renderIssuePayload (this file)
//   6. REOPEN CONTEXT       ── renderReopenBlock (this file)
//   7. CLOSING              ── renderClosing (this file)

export const COMPLETION_SIGNAL = '<promise>COMPLETE</promise>';

// Reopen context: PR review threads can grow long on busy repos. Bound
// the size so reopen-heavy issues don't blow the prompt up.
const MAX_PR_COMMENTS_IN_PROMPT = 30;

export type PriorAttemptContext = {
  endedAt: string | null;
  prUrl: string | null;
  prComments: PRComment[];
  // Note: this list still includes HITL-marked Jira comments-since;
  // the orchestrator splits Jira comments BEFORE invoking buildPrompt,
  // so HITL ones get rendered in section 4 (renderHitlBlock) and the
  // rest end up in the reopen block alongside PR comments.
  jiraCommentsSince: import('../../integrations/jira/jira.client.js').JiraComment[];
};

// ─────────────────────────────────────────────────────────────────────
// Universal Constraints — section 3 (identical for all three shapes)
// ─────────────────────────────────────────────────────────────────────
//
// The `depsInstalledHint` parameter tells the agent what the
// orchestrator-driven dep-install did (only applies in
// code-improvement-shape attempts; bug/feature shapes always pass
// `null` because they don't install).
export function renderUniversalConstraints(opts: {
  depsInstalledHint: 'installed' | 'failed' | 'not-attempted';
}): string[] {
  const out: string[] = [];
  out.push('## Universal constraints — these apply regardless of issue type');
  out.push('');
  out.push('- **Do NOT push, open a PR, or merge.** The orchestrator owns those steps after the agent finishes.');
  out.push('- **Do NOT run the project\'s test suite.** Tests are slow and fail for environmental reasons — they\'re for CI on the resulting PR.');
  out.push(
    `- **Do NOT install dependencies.** Many projects need private-registry auth or env-var config that isn't available in the worktree.${
      opts.depsInstalledHint === 'installed'
        ? ' (The orchestrator already installed deps for you before this run started.)'
        : opts.depsInstalledHint === 'failed'
          ? ' (The orchestrator attempted to install deps for this code-improvement attempt and the install FAILED — fall back to read-based verification only; do not retry the install yourself.)'
          : ''
    }`,
  );
  out.push('- **Read repo conventions before changing code.** If any of `CONTEXT.md`, `CLAUDE.md`, `AGENT.md`, or `README.md` exist at the repo root, read them first — they capture conventions you cannot infer from code alone (vocabulary, architectural decisions, coding style).');
  out.push('- **Static checker, when runnable:** If the project\'s static checker is ALREADY runnable in this worktree (`node_modules/` present → `npx tsc --noEmit` or `npx eslint <files>`; `.venv/` present → `mypy <files>` or `ruff check <files>`; Go → `go vet ./...`; Rust → `cargo check`; PHP → `php -l <file>` for syntax, `vendor/bin/phpstan analyse <files>` if vendor present), run it on your changes and fix any new errors before committing. If it\'s NOT runnable, fall back to reading every function you touched + its callers (Read, Grep) — same discipline, manual tools.');
  out.push(`- **Completion signal:** When you have either (a) committed your changes or (b) decided to escalate, emit ${COMPLETION_SIGNAL} as the last line of your final message.`);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// HITL Directives — section 4 (only rendered when there are HITL comments)
// ─────────────────────────────────────────────────────────────────────
//
// The HITL block intentionally comes BEFORE the issue payload so the
// agent reads human investigation findings before the raw description.
// In bug-shape these become hypothesis #1; in feature/code-improvement
// shapes they're the canonical scope/approach.
export function renderHitlBlock(split: CommentSplit): string[] {
  if (split.hitl.length === 0) return [];
  const out: string[] = [];
  out.push('## Human directives — follow these');
  out.push('');
  out.push(
    'The Jira comments below are flagged with the `+hitl-to-agent+` marker — a human (typically a developer who already started investigating) has indicated these are the authoritative steer. Treat them as first-class input: in bug-shape work, the HITL diagnosis becomes hypothesis #1; in feature-shape work, the HITL approach is the canonical design; in code-improvement-shape work, the HITL boundary is the canonical scope. Investigate alternatives only if the discipline for your shape requires it.',
  );
  for (const c of split.hitl) {
    out.push('');
    out.push(`### ${c.author} — ${c.createdAt}`);
    out.push('');
    out.push(c.body || '_(empty comment)_');
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Issue Payload — section 5
// ─────────────────────────────────────────────────────────────────────
//
// Renders the issue header + description + non-HITL regular comments
// (capped). The issue type is included explicitly in the heading per
// Q4b — primes the agent's framing.
export function renderIssuePayload(args: {
  issue: JiraIssue;
  split: CommentSplit;
}): string[] {
  const { issue, split } = args;
  const out: string[] = [];
  out.push(`## Jira issue ${issue.key} — ${issue.summary}`);
  out.push('');
  out.push(`- Type: ${issue.issuetype || '(unknown)'}`);
  out.push(`- Status: ${issue.status || '(unknown)'}`);
  out.push('');
  out.push('### Description');
  out.push('');
  out.push(adfToMarkdown(issue.descriptionAdf) || '_(no description)_');

  if (split.regular.length > 0) {
    out.push('');
    out.push('### Additional context — comments (most recent first)');
    if (split.regularTruncated) {
      out.push('');
      out.push(
        `_Showing ${split.regular.length} most-recent comments. ${split.regularOmittedCount} older comment${split.regularOmittedCount === 1 ? '' : 's'} omitted to keep this focused._`,
      );
    }
    for (const c of split.regular) {
      out.push('');
      out.push(`#### ${c.author} — ${c.createdAt}`);
      out.push('');
      out.push(c.body || '_(empty comment)_');
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Reopen Context — section 6 (only when this attempt has a prior)
// ─────────────────────────────────────────────────────────────────────
export function renderReopenBlock(prior: PriorAttemptContext | undefined): string[] {
  if (!prior) return [];
  const out: string[] = [];
  out.push('---');
  out.push('');
  out.push('## This Jira issue was previously attempted');
  if (prior.prUrl) {
    out.push('');
    out.push(`Prior PR: ${prior.prUrl}`);
  }

  const prComments = [...prior.prComments]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, MAX_PR_COMMENTS_IN_PROMPT);
  if (prComments.length > 0) {
    out.push('');
    out.push('### Review feedback on the prior PR (most recent first)');
    if (prior.prComments.length > prComments.length) {
      out.push('');
      out.push(
        `_Showing ${prComments.length} of ${prior.prComments.length} comments. Older ones omitted._`,
      );
    }
    for (const c of prComments) {
      out.push('');
      const loc = c.path ? ` on \`${c.path}\`${c.line ? `:${c.line}` : ''}` : '';
      out.push(`#### ${c.user} — ${c.ts}${loc}`);
      out.push('');
      out.push(c.body.trim() || '_(empty comment)_');
    }
  } else if (prior.prUrl) {
    out.push('');
    out.push('_No review comments on the prior PR._');
  }

  if (prior.jiraCommentsSince.length > 0) {
    out.push('');
    const since = prior.endedAt ? ` after the prior attempt ended (${prior.endedAt})` : '';
    out.push(`### Non-HITL Jira comments added${since}`);
    for (const c of prior.jiraCommentsSince) {
      out.push('');
      out.push(`#### ${c.author} — ${c.createdAt}`);
      out.push('');
      out.push(adfToMarkdown(c.bodyAdf) || '_(empty comment)_');
    }
  }

  out.push('');
  out.push(
    'Address this feedback in your changes. Do not undo prior work unless the feedback explicitly asks for it.',
  );
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Closing — section 7
// ─────────────────────────────────────────────────────────────────────
export function renderClosing(args: { issueKey: string }): string[] {
  return [
    '---',
    '',
    `Now begin. Resolve Jira issue **${args.issueKey}** following the discipline above. Work in the current branch and current working directory. Make commits as you go (small, focused commits are fine — the orchestrator squashes them into one before pushing). When done, emit ${COMPLETION_SIGNAL} as your final message.`,
  ];
}
