import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type LogLevel = 'info' | 'warn' | 'error';
type LogLine = {
  ts: string;
  src: string;
  level: LogLevel;
  msg: string;
  data?: Record<string, unknown>;
};

type Status = { kind: 'idle' } | { kind: 'running'; attemptId: string };

const SRC_COLORS: Record<string, string> = {
  orchestrator: 'text-blue-500',
  git: 'text-purple-500',
  github: 'text-emerald-500',
  jira: 'text-orange-500',
  sandcastle: 'text-cyan-500',
  logs: 'text-muted-foreground',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: 'text-foreground',
  warn: 'text-yellow-600',
  error: 'text-destructive',
};

const MAX_BUFFER = 2000;

export function LiveLogsPanel({ spaceId }: { spaceId: string }): React.ReactElement {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [mode, setMode] = useState<'pretty' | 'raw'>('pretty');
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    const es = new EventSource(`/api/spaces/${spaceId}/logs/stream`);

    es.addEventListener('attempt_start', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { attemptId: string };
      setStatus({ kind: 'running', attemptId: data.attemptId });
      setLines([]); // fresh attempt = fresh buffer
    });

    es.addEventListener('line', (e) => {
      const parsed = JSON.parse((e as MessageEvent).data) as LogLine;
      setLines((prev) => {
        const next = prev.length >= MAX_BUFFER ? prev.slice(-(MAX_BUFFER - 1)) : prev;
        return [...next, parsed];
      });
    });

    es.addEventListener('attempt_end', () => {
      setStatus({ kind: 'idle' });
    });

    es.addEventListener('idle', () => {
      setStatus({ kind: 'idle' });
    });

    es.onerror = () => {
      // Browser EventSource auto-reconnects with backoff. Nothing for us to
      // do — the next attempt_start/idle event will resync state.
    };

    return () => {
      es.close();
    };
  }, [spaceId]);

  // Auto-scroll to bottom when new lines arrive, but only if the user
  // hasn't scrolled up to read older lines.
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  function onScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    autoScrollRef.current = distanceFromBottom < 10;
  }

  const isRunning = status.kind === 'running';

  return (
    <div className="border-border bg-card rounded-lg border">
      <header className="border-border flex items-center justify-between border-b px-4 py-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              isRunning ? 'animate-pulse bg-green-500' : 'bg-muted-foreground',
            )}
          />
          Live logs
          {isRunning && (
            <span className="text-muted-foreground text-xs font-normal">
              · attempt {status.attemptId.slice(0, 8)}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setMode('pretty')}
            className={cn(
              'rounded-md px-2 py-0.5',
              mode === 'pretty'
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Pretty
          </button>
          <button
            type="button"
            onClick={() => setMode('raw')}
            className={cn(
              'rounded-md px-2 py-0.5',
              mode === 'raw'
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Raw
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="bg-background h-80 overflow-y-auto p-3 font-mono text-xs"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground">
            {isRunning ? 'Waiting for events…' : 'No attempt in progress. Click "Tick now" above.'}
          </p>
        ) : mode === 'pretty' ? (
          lines.map((l, i) => <PrettyLine key={i} line={l} />)
        ) : (
          lines.map((l, i) => (
            <pre key={i} className="text-foreground break-words whitespace-pre-wrap">
              {JSON.stringify(l)}
            </pre>
          ))
        )}
      </div>
    </div>
  );
}

function PrettyLine({ line }: { line: LogLine }): React.ReactElement {
  const time = new Date(line.ts).toLocaleTimeString('en-US', { hour12: false });
  const srcColor = SRC_COLORS[line.src] ?? 'text-muted-foreground';
  const levelColor = LEVEL_COLORS[line.level] ?? 'text-foreground';
  return (
    <div className="leading-relaxed break-words whitespace-pre-wrap">
      <span className="text-muted-foreground">{time}</span>{' '}
      <span className={srcColor}>[{line.src}]</span>{' '}
      <span className={levelColor}>{line.msg}</span>
    </div>
  );
}
