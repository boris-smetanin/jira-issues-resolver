import { adfToMarkdown } from '../integrations/adf/adf.formatter.js';
import type { JiraComment } from '../integrations/jira/jira.client.js';

// Slice 16b: HITL comment handling. A comment whose body (rendered to
// markdown) contains the marker `+hitl-to-agent+` anywhere — case-
// insensitive — is HITL: human prior investigation that the agent must
// treat as first-class context.
//
// `HITL_MARKER` is compared as a substring match on the lowercased
// markdown body. The match doesn't have to be at the start of a line.

export const HITL_MARKER = '+hitl-to-agent+';

// We cap regular (non-HITL) comments to keep prompts focused on the
// signal that matters. HITL comments are NEVER capped — multiple
// developers may add HITL findings and all of them must reach the agent.
export const MAX_REGULAR_COMMENTS = 5;

export type RenderedComment = {
  author: string;
  createdAt: string;
  body: string;
};

export type CommentSplit = {
  hitl: RenderedComment[];
  regular: RenderedComment[];
  // True when at least one regular comment was dropped due to the cap.
  // Surface in the prompt so the agent knows older signal exists if it
  // explicitly asks the human for it (escalation).
  regularTruncated: boolean;
  regularOmittedCount: number;
};

// Render each Jira comment's ADF body to markdown once, then partition
// by HITL marker. HITL comments are returned in chronological order
// (oldest → newest) so the agent reads the investigation thread in
// sequence — the convention developers use when adding follow-up HITL
// notes.
//
// Regular comments are returned in most-recent-first order, capped at
// `MAX_REGULAR_COMMENTS`; older ones drop off with the count surfaced
// via `regularOmittedCount`.
export function splitComments(comments: JiraComment[]): CommentSplit {
  const hitl: RenderedComment[] = [];
  const regular: RenderedComment[] = [];

  for (const c of comments) {
    const body = adfToMarkdown(c.bodyAdf) || '';
    const rendered: RenderedComment = {
      author: c.author,
      createdAt: c.createdAt,
      body,
    };
    if (body.toLowerCase().includes(HITL_MARKER)) {
      hitl.push(rendered);
    } else {
      regular.push(rendered);
    }
  }

  // HITL: oldest → newest. (Source `comments` is already ascending by
  // createdAt — `getComments` requests `orderBy=created` — so this is
  // structural, but sort explicitly for resilience to upstream changes.)
  hitl.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Regular: most recent first, then trim.
  regular.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cappedRegular = regular.slice(0, MAX_REGULAR_COMMENTS);
  const regularOmittedCount = regular.length - cappedRegular.length;

  return {
    hitl,
    regular: cappedRegular,
    regularTruncated: regularOmittedCount > 0,
    regularOmittedCount,
  };
}
