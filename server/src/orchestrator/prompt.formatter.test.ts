import { describe, expect, it } from 'vitest';
import type { PromptShape } from '@jir/shared';
import { loadFixture } from '../__test__/loadFixture.js';
import type { JiraComment, JiraIssue } from '../integrations/jira/jira.client.js';
import { buildPrompt, type PriorAttemptContext } from './prompt.formatter.js';

// Slice 0013: Core 4 — Prompt Builder tests.
//
// Strategy: file-based snapshots. Each fixture exercises a different
// path through the shape-dispatched prompt builder (slice 16b). When
// the prompt text changes intentionally, run `vitest --update` once
// and the diff shows up in the PR for explicit review.
//
// Fixture coverage:
//   - bug-simple: bug-shape, no comments, no prior
//   - feature-multi-comment: feature-shape with 5 comments (one HITL)
//   - code-improvement-simple: code-improvement-shape with depsInstalledHint
//   - reopen-once: bug-shape with one prior attempt + PR review comments
//   - reopen-with-jira-comments-since: feature-shape, prior PR + new Jira comments
//   - no-description-only-comments: descriptionAdf=null + HITL comment

type Fixture = {
  shape: PromptShape | null;
  depsInstalledHint?: 'installed' | 'failed' | 'not-attempted';
  issue: JiraIssue;
  comments: JiraComment[];
  prior?: PriorAttemptContext;
};

function runFixture(name: string): string {
  const f = loadFixture<Fixture>(import.meta.url, name);
  return buildPrompt({
    issue: f.issue,
    comments: f.comments,
    shape: f.shape,
    ...(f.prior ? { prior: f.prior } : {}),
    ...(f.depsInstalledHint ? { depsInstalledHint: f.depsInstalledHint } : {}),
  });
}

describe('buildPrompt — snapshots', () => {
  it('bug-shape, simple issue, no comments, no prior', () => {
    expect(runFixture('bug-simple')).toMatchSnapshot();
  });

  it('feature-shape with 5 comments including HITL', () => {
    expect(runFixture('feature-multi-comment')).toMatchSnapshot();
  });

  it('code-improvement-shape with depsInstalledHint=installed', () => {
    expect(runFixture('code-improvement-simple')).toMatchSnapshot();
  });

  it('bug-shape reopen with PR review comments', () => {
    expect(runFixture('reopen-once')).toMatchSnapshot();
  });

  it('feature-shape reopen with PR review + new Jira comments', () => {
    expect(runFixture('reopen-with-jira-comments-since')).toMatchSnapshot();
  });

  it('null description + HITL-only comment', () => {
    expect(runFixture('no-description-only-comments')).toMatchSnapshot();
  });
});

describe('buildPrompt — shape dispatch', () => {
  // Belt-and-braces: even if all snapshots above pass, verify the
  // dispatcher contract directly — null/undefined/'feature' all hit
  // the feature builder (the universal fallback).
  function minimal(shape: PromptShape | null): string {
    return buildPrompt({
      issue: {
        key: 'RND-1',
        summary: 's',
        status: 'In Progress',
        issuetype: 'X',
        descriptionAdf: null,
      },
      comments: [],
      shape,
    });
  }

  it('null shape falls back to feature template', () => {
    expect(minimal(null)).toBe(minimal('feature'));
  });
});
