import { cn } from '@/lib/utils';

// Per-Space loop state pill. Two states only — running with an animated
// dot, stopped without. Used on the SpacesGrid card and Space detail
// header.
export function LoopStatusPill({
  running,
  className,
}: {
  running: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        running
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
        className,
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          running ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400',
        )}
      />
      {running ? 'running' : 'stopped'}
    </span>
  );
}
