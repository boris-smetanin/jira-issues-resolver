# 0005 — First real tick: agent runs locally, commits in worktree (no push)

## What to build

Replace slice 0004's placeholder with the real orchestrator, stopping just before push. Demoable result: a tick on a Space with a matching Jira issue produces a real local branch in `data/repos/<spaceId>/wt/<issueKey>/` containing one squashed agent commit. The state machine has walked through PREPARING_REPO → AGENT_RUNNING → CHECKING_COMMITS → FINISHED. No GitHub side-effects, no Jira transition.

Build:

- `integrations/git/git.client.ts` gets: `cloneRepo({ url, token, dest })`, `fetchOrigin(repoDir)`, `lsRemoteBranch(repoDir, branchName) → bool`, `worktreeAdd(repoDir, wtPath, ref)`, `worktreeRemove(repoDir, wtPath)`, `revList(wtPath, base, head) → sha[]`, `commit(wtPath, message)`, `resetSoft(wtPath, ref)`, `headSubjectBody(wtPath) → { subject, body }`, `configUser(wtPath, name, email)`.
- `integrations/jira/jira.client.ts` gets: `getIssue(key) → { summary, descriptionAdf }`, `getComments(key) → Array<{ author, ts, bodyAdf }>`.
- `orchestrator/prompt.formatter.ts` — pure function `buildPrompt({ issue, comments, priorAttempts? }) → string`. Uses an ADF→markdown library wrapper. Reopen context is NOT included yet (lands in slice 0009).
- `orchestrator/branch.resolver.ts` — encodes Q10:
  ```
  prepareWorktree({ space, attempt }) → worktreePath
    1. ensure persistent clone exists at data/repos/<spaceId>/ (clone if missing)
    2. git fetch origin
    3. remoteExists = lsRemoteBranch('refs/heads/<issueKey>')
    4. wt path = data/repos/<spaceId>/wt/<issueKey>
    5. worktreeAdd(wt, remoteExists ? origin/<issueKey> : origin/<baseBranch>)
       creating local branch <issueKey>
    6. configUser(wt, space.committer_name, space.committer_email)
    7. return wt
  ```
- `orchestrator/commit.finalizer.ts` — encodes Q24:
  ```
  finalize({ wt, base, issueKey, attemptId, priorAttemptId? }) → { commits: 0|1 }
    1. newSha = revList(base..HEAD)
    2. if newSha.empty → { commits: 0 }
    3. { subject, body } = headSubjectBody(wt)
    4. subject = strip-prefix(subject, issueKey)  // dedupe if agent already prefixed
    5. resetSoft(wt, base)
    6. commit(wt, `<issueKey> <subject>\n\n<body>\n\nResolve-Attempt: <attemptId>${priorAttemptId ? `\nPrior-Attempt: <priorAttemptId>` : ''}`)
    7. return { commits: 1 }
  ```
- `integrations/sandcastle/sandcastle.runner.ts` — wraps Sandcastle's `run()`. For now only `host` mode: `noSandboxProvider({ branchStrategy: 'head' })`. Provider chosen by `space.agent_provider` (`claudeCode(model)` only in this slice; Codex lands in slice 0012). Forwards stream events via the `onAgentStreamEvent` callback to a placeholder callback (the real log writer lands in slice 0007).
- `orchestrator/orchestrator.service.ts` — `runAttempt({ space, attempt }) → void`:
  ```
  try {
    transition(attempt, PREPARING_REPO)
    issue    = jira.getIssue(attempt.issueKey)
    comments = jira.getComments(attempt.issueKey)
    base     = remoteExists ? origin/<issueKey> : origin/<baseBranch>
    wt       = branchResolver.prepareWorktree({ space, attempt })
    prompt   = promptBuilder.build({ issue, comments })

    transition(attempt, AGENT_RUNNING)
    sandcastleRunner.run({ space, worktree: wt, prompt, onEvent: noop })

    transition(attempt, CHECKING_COMMITS)
    { commits } = commitFinalizer.finalize({ wt, base, issueKey, attemptId: attempt.id })

    if (commits === 0) → mark FINISHED_NO_CHANGES, return
    transition(attempt, FINISHED)   // temporary; push+PR+transition land in slice 0006
  } catch (err) {
    mark FAILED with error_reason + stuck_at_status
  } finally {
    git.worktreeRemove(wt) // even on FAILED (slice 0006 may refine)
  }
  ```
- `resolve-loop.service.ts.tickOnce()` (from slice 0004) now invokes `orchestrator.runAttempt()` instead of immediately marking terminal.
- The "Tick now" button now exercises the real path against the user's real repo.

## Acceptance criteria

- [ ] Clicking "Tick now" on a Space with one matching Jira issue produces: one resolve_attempts row in `FINISHED` or `FINISHED_NO_CHANGES`, one local branch `<issueKey>` containing exactly one new commit beyond `<baseBranch>` (if non-empty), the commit subject begins with `<ISSUE-KEY>`, the commit body contains `Resolve-Attempt: <uuid>` as a git trailer.
- [ ] If the agent makes zero file changes, the attempt is `FINISHED_NO_CHANGES`, no commit exists, and no local branch is left behind (worktree removed).
- [ ] If the agent makes multiple commits, `commit.finalizer` squashes them to one before recording FINISHED.
- [ ] The local clone `data/repos/<spaceId>/` is created on first tick; subsequent ticks reuse it.
- [ ] Worktree at `data/repos/<spaceId>/wt/<issueKey>/` is removed at end of attempt (FINISHED, FINISHED_NO_CHANGES, or FAILED).
- [ ] On a Jira issue whose branch already exists at `origin/<issueKey>`, the worktree tracks that branch (verifiable: `git -C wt log` shows the existing commits + the new one on top).
- [ ] No `git push` is invoked. No GitHub API write. No Jira transition.
- [ ] State machine telemetry: each transition can be observed by querying the row's `status` mid-run (use `pg_sleep` or a slow agent prompt to validate transition order).

## Blocked by

- 0004 — Tick-now → empty Resolve Attempt → FINISHED_NO_CHANGES
