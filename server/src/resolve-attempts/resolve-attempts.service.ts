import type { ResolveAttempt } from '@jir/shared';
import {
  create as repoCreate,
  findById as repoFindById,
  findInFlightForIssue as repoFindInFlight,
  findPriorsForIssue as repoFindPriors,
  findRunningForSpace as repoFindRunningForSpace,
  listBySpace as repoListBySpace,
  markOrphanedAttempts as repoMarkOrphaned,
  transitionStatus as repoTransitionStatus,
} from './resolve-attempts.repository.js';

export async function findAttemptById(id: string): Promise<ResolveAttempt | null> {
  return repoFindById(id);
}

export async function listAttemptsBySpace(spaceId: string): Promise<ResolveAttempt[]> {
  return repoListBySpace(spaceId);
}

export async function findInFlightForIssue(
  spaceId: string,
  issueKey: string,
): Promise<ResolveAttempt | null> {
  return repoFindInFlight(spaceId, issueKey);
}

export async function findRunningForSpace(spaceId: string): Promise<ResolveAttempt | null> {
  return repoFindRunningForSpace(spaceId);
}

// Called from boot before resumeRunningLoops — any attempt left in a
// non-terminal state from a previous process gets marked FAILED.
export async function markOrphanedAttempts(reason: string): Promise<string[]> {
  return repoMarkOrphaned(reason);
}

// Caller is responsible for the "no in-flight attempt" check. Returns the
// newly created QUEUED row with attempt_number + prior_attempt_id wired up:
// first attempt for an issue → attempt_number=1, prior=null.
// Subsequent → attempt_number = max+1, prior = id of the latest prior.
export async function createNextAttempt({
  spaceId,
  issueKey,
}: {
  spaceId: string;
  issueKey: string;
}): Promise<ResolveAttempt> {
  const priors = await repoFindPriors(spaceId, issueKey);
  const attemptNumber = priors.length + 1;
  const priorAttemptId = priors.length > 0 ? priors[priors.length - 1]!.id : null;
  return repoCreate({
    spaceId,
    issueKey,
    attemptNumber,
    priorAttemptId,
    // CONTEXT.md: branch_name equals the Jira issue key (e.g. 'RND-1').
    branchName: issueKey,
  });
}

// Slice 4 stub helper: skip all the real orchestration and mark the attempt
// immediately terminal. Slice 5 will replace the caller with the actual
// state-machine walker.
export async function markFinishedNoChanges(id: string): Promise<ResolveAttempt> {
  return repoTransitionStatus(id, 'FINISHED_NO_CHANGES', { endedAt: new Date() });
}
