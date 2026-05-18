# 0006 — Push + PR open + Jira transition (full happy path)

## What to build

Complete the orchestrator's tail: after `CHECKING_COMMITS` produces a commit, the server pushes the branch to GitHub (with `--force-with-lease`), opens a PR if none exists, and transitions the Jira issue to the Space's `target_status_name`. State machine reaches the real `FINISHED`. This is the first slice where a tick produces external side effects.

Build:

- `integrations/git/git.client.ts` gets `push(wtPath, branch, token, { force-with-lease: true })`. Uses the `GIT_ASKPASS` pattern from the auto-bug-fixer reference: a tempfile shell script `echo "$GITHUB_TOKEN"`; spawn `git` with `GIT_ASKPASS=<script>` and `GITHUB_TOKEN=<token>` in the env. Token never appears in argv or the URL.
- `integrations/github/github.client.ts` gets: `findPRByBranch({ owner, repo, branch, token }) → PullRequest | null`, `createPR({ owner, repo, title, body, head, base, token }) → PullRequest`.
- `orchestrator/pr-body.formatter.ts` — pure function `formatPullRequestTitle(issue) → string`, `formatPullRequestBody({ issue, attempt, priorAttempt? }) → string`. Title: `<ISSUE-KEY> <issue.summary>`. Body: issue description (rendered from ADF), a divider, then a footer with the resolve-attempt id and a link to the Jira issue.
- `integrations/jira/jira.client.ts` gets: `listTransitions(key) → Array<{ id, name, to: { id, name } }>`, `transitionIssue(key, transitionId) → void`.
- `orchestrator/orchestrator.service.ts` extended:
  ```
  // …after commit.finalizer returns { commits: 1 }:

  transition(attempt, PUSHING)
  git.push(wt, attempt.branchName, space.github_token,
           { force-with-lease: true })

  transition(attempt, OPENING_PR)
  existing = github.findPRByBranch(...)
  pr = existing ?? github.createPR({
         title: prBodyFormatter.title(issue),
         body:  prBodyFormatter.body({ issue, attempt, priorAttempt }),
         head:  attempt.branchName,
         base:  space.baseBranch,
       })
  attempt.pr_url    = pr.html_url
  attempt.pr_number = pr.number

  transition(attempt, TRANSITIONING_JIRA)
  trs = jira.listTransitions(attempt.issueKey)
  match = trs.find(t => t.to.name === space.target_status_name)
  if (match) {
    try { jira.transitionIssue(attempt.issueKey, match.id) }
    catch (err) { attempt.transition_warning = err.message }
  } else {
    attempt.transition_warning = `No transition from current status to ${space.target_status_name}`
  }

  mark FINISHED
  ```
- Worktree cleanup moved to AFTER successful push (so failed pushes leave the worktree on disk for debugging).
- Web: the Space detail page's attempt list now shows the PR URL as a clickable link when present.

## Acceptance criteria

- [ ] One full tick against a real Jira issue produces: a remote branch `<issueKey>` on the target repo, an open PR with title `<ISSUE-KEY> <summary>`, the Jira issue transitioned to `target_status_name`, the attempt row at `status = FINISHED` with `pr_url` and `pr_number` populated.
- [ ] If a Jira workflow has no valid transition from the issue's current status to the target, the attempt is still `FINISHED` (soft-fail per Q14) with `transition_warning` populated. The PR is still opened.
- [ ] If `push --force-with-lease` is rejected (someone else pushed in between), the attempt is FAILED with `stuck_at_status = PUSHING` and a clear `error_reason`.
- [ ] If the PR open call returns "PR already exists" (existing branch with PR), the existing PR is fetched and `pr_url` is recorded without creating a duplicate.
- [ ] The GitHub token never appears in argv (`ps aux`), the URL, or the git reflog.
- [ ] Commit on the remote branch matches the local commit hash exactly (no rewrite during push).
- [ ] Worktree at `data/repos/<spaceId>/wt/<issueKey>/` is removed after FINISHED; preserved on FAILED until next tick.

## Blocked by

- 0005 — First real tick: agent runs locally, commits in worktree (no push)
