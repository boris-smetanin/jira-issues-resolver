import type { AttemptStatus } from '@jir/shared';
import { cn } from '@/lib/utils';

// Maps the underlying AttemptStatus values to 6 visual buckets:
//   queued        → amber
//   in-flight     → blue with animated dot (any state mid-pipeline)
//   finished      → emerald (PR opened)
//   no-changes    → neutral (agent ran but produced no diff)
//   failed        → red
//   escalated     → indigo/violet (agent decided it can't safely commit)
//
// Single-source of truth — Space detail page, detail page header, and
// inline lists all import from here.

type Bucket = 'queued' | 'in-flight' | 'finished' | 'no-changes' | 'failed' | 'escalated';

const BUCKET_FOR: Record<AttemptStatus, Bucket> = {
  QUEUED: 'queued',
  PREPARING_REPO: 'in-flight',
  AGENT_RUNNING: 'in-flight',
  CHECKING_COMMITS: 'in-flight',
  PUSHING: 'in-flight',
  OPENING_PR: 'in-flight',
  TRANSITIONING_JIRA: 'in-flight',
  FINISHED: 'finished',
  FINISHED_NO_CHANGES: 'no-changes',
  FAILED: 'failed',
  ESCALATED: 'escalated',
};

const BUCKET_STYLE: Record<Bucket, { bg: string; dot: string }> = {
  queued: {
    bg: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  'in-flight': {
    bg: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
    dot: 'bg-blue-500 animate-pulse',
  },
  finished: {
    bg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  'no-changes': {
    bg: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    dot: 'bg-neutral-400',
  },
  failed: {
    bg: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    dot: 'bg-red-500',
  },
  escalated: {
    bg: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
};

// Human-readable label that's slightly shorter than the raw status enum.
// Falls back to lowercased-with-spaces if we add a new status and forget
// to handle it here.
const LABEL_FOR: Record<AttemptStatus, string> = {
  QUEUED: 'queued',
  PREPARING_REPO: 'preparing repo',
  AGENT_RUNNING: 'agent running',
  CHECKING_COMMITS: 'checking commits',
  PUSHING: 'pushing',
  OPENING_PR: 'opening PR',
  TRANSITIONING_JIRA: 'updating Jira',
  FINISHED: 'finished',
  FINISHED_NO_CHANGES: 'no changes',
  FAILED: 'failed',
  ESCALATED: 'escalated',
};

export function AttemptStatusPill({
  status,
  className,
}: {
  status: AttemptStatus;
  className?: string;
}): React.ReactElement {
  const bucket = BUCKET_FOR[status];
  const style = BUCKET_STYLE[bucket];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        style.bg,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {LABEL_FOR[status]}
    </span>
  );
}
