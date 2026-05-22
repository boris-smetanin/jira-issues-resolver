import type { PromptShape } from '@jir/shared';
import type { PRComment } from '../integrations/github/github.client.js';
import type { JiraComment, JiraIssue } from '../integrations/jira/jira.client.js';
import { splitComments } from './comments.js';
import { buildBugShapedPrompt } from './prompts/bug-shaped.js';
import { buildCodeImprovementShapedPrompt } from './prompts/code-improvement-shaped.js';
import { buildFeatureShapedPrompt } from './prompts/feature-shaped.js';
import type { PriorAttemptContext as SharedPriorContext } from './prompts/shared.js';

// Slice 16b: prompt dispatcher. The orchestrator resolves the issue's
// shape (bug / code-improvement / feature) via `shapeFor()`, then calls
// `buildPrompt` with `shape` to pick the right per-shape builder.
//
// `shape = null` (an issuetype that didn't match any configured list —
// JQL should prevent this, but defensible) falls back to feature-shaped
// as the most general — matches the original grilling decision to
// "combine with B for unknown issuetype" but simplified: we just use
// feature-shape as the universal fallback rather than authoring a
// distinct hybrid template.

// Re-export PriorAttemptContext so callers (orchestrator.service)
// continue to import it from this file as they did before slice 16b.
export type PriorAttemptContext = SharedPriorContext;

export type BuildPromptArgs = {
  issue: JiraIssue;
  comments: JiraComment[];
  prior?: PriorAttemptContext;
  // Resolved shape from issue-type-map. Null means the issuetype didn't
  // match any configured list — feature-shape used as fallback.
  shape: PromptShape | null;
  // For code-improvement attempts only: whether the orchestrator
  // installed deps before invoking the agent. Bug/feature attempts pass
  // 'not-attempted' (no install for those shapes).
  depsInstalledHint?: 'installed' | 'failed' | 'not-attempted';
};

export function buildPrompt(args: BuildPromptArgs): string {
  const { issue, comments, prior, shape, depsInstalledHint = 'not-attempted' } = args;
  const split = splitComments(comments);

  switch (shape) {
    case 'bug':
      return buildBugShapedPrompt({ issue, split, prior });
    case 'code-improvement':
      return buildCodeImprovementShapedPrompt({
        issue,
        split,
        prior,
        depsInstalledHint,
      });
    case 'feature':
    case null:
    case undefined:
    default:
      return buildFeatureShapedPrompt({ issue, split, prior });
  }
}

// Re-export so existing test scripts that imported PRComment from this
// file keep working without changes.
export type { PRComment };
