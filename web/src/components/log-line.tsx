import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogLine = {
  ts: string;
  src: string;
  level?: LogLevel;
  msg: string;
  data?: Record<string, unknown>;
};

// Shared by LiveLogsPanel + the per-attempt detail page. Renders one log
// event as: HH:MM:SS.mmm [src in color] msg (with extracted context in
// italic muted) plus a chevron that reveals the raw JSON for the full row.
export function LogLineRow({ line }: { line: LogLine }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const time = shortTime(line.ts);
  const srcClass = sourceClass(line.src);
  const msgClass = levelTextClass(line.level);
  const contextClass = contextTextClass(line.level);
  const context = extractContext(line);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="border-b border-neutral-200/40 last:border-0 dark:border-neutral-800/40">
      <div className="flex items-start gap-2 rounded px-1 py-1 hover:bg-neutral-100/60 dark:hover:bg-neutral-900/60">
        <span className="w-[7rem] shrink-0 select-text text-neutral-400">{time}</span>
        <span className={cn('w-[6.5rem] shrink-0 select-text', srcClass)}>{line.src}</span>
        <div className="min-w-0 flex-1 select-text whitespace-pre-wrap break-words">
          <span className={msgClass}>{line.msg}</span>
          {context && <span className={cn('ml-2 italic', contextClass)}>{context}</span>}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="shrink-0 cursor-pointer rounded p-0.5 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200"
        >
          <Chevron className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && (
        <pre className="mt-1 ml-[7rem] select-text overflow-x-auto rounded bg-neutral-100 p-2 text-[10px] leading-snug text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
{JSON.stringify(line, null, 2)}
        </pre>
      )}
    </div>
  );
}

function shortTime(ts: string): string {
  try {
    // HH:MM:SS.mmm — leaves the date off; logs are usually viewed for a
    // single attempt run inside one day.
    return new Date(ts).toISOString().slice(11, 23);
  } catch {
    return ts;
  }
}

// Map our log sources (orchestrator | git | github | jira | sandcastle |
// logs) to a stable color. Anything unknown falls back to muted neutral.
function sourceClass(src: string): string {
  if (src === 'orchestrator') return 'text-indigo-600 dark:text-indigo-400';
  if (src === 'sandcastle') return 'text-emerald-600 dark:text-emerald-400';
  if (src === 'git') return 'text-purple-600 dark:text-purple-400';
  if (src === 'github') return 'text-cyan-700 dark:text-cyan-400';
  if (src === 'jira') return 'text-orange-700 dark:text-orange-400';
  return 'text-neutral-500';
}

function levelTextClass(level: LogLevel | undefined): string {
  if (level === 'warn') return 'text-amber-700 dark:text-amber-300';
  if (level === 'error') return 'text-red-700 dark:text-red-300';
  return 'text-neutral-800 dark:text-neutral-100';
}

function contextTextClass(level: LogLevel | undefined): string {
  if (level === 'warn') return 'text-amber-600 dark:text-amber-400';
  if (level === 'error') return 'text-red-600 dark:text-red-400';
  return 'text-neutral-500 dark:text-neutral-400';
}

// Extract a short context blurb from `data` for sandcastle tool calls and
// agent text events. Keeps the main row tight — full payload is available
// behind the chevron.
function extractContext(line: LogLine): string | undefined {
  const data = (line.data ?? {}) as Record<string, unknown>;

  if (data.eventType === 'toolCall' && typeof data.tool === 'string') {
    return undefined; // tool name + args already in line.msg
  }
  // Heuristic — surface anything that smells like a file path / branch /
  // PR URL / issue key as a hint.
  for (const key of ['prUrl', 'priorPrUrl', 'baseRef', 'summary', 'priorAttemptId']) {
    const v = data[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
