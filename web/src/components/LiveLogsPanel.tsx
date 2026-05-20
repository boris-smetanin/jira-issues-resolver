import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogLineRow, type LogLine } from './log-line';
import { cn } from '@/lib/utils';

type Status = { kind: 'idle' } | { kind: 'running'; attemptId: string };

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
      setLines([]);
    });

    es.addEventListener('line', (e) => {
      const parsed = JSON.parse((e as MessageEvent).data) as LogLine;
      setLines((prev) => {
        const next = prev.length >= MAX_BUFFER ? prev.slice(-(MAX_BUFFER - 1)) : prev;
        return [...next, parsed];
      });
    });

    es.addEventListener('attempt_end', () => setStatus({ kind: 'idle' }));
    es.addEventListener('idle', () => setStatus({ kind: 'idle' }));

    es.onerror = () => {
      // Browser EventSource auto-reconnects with backoff. Nothing for us to
      // do — the next attempt_start/idle event will resync state.
    };

    return () => {
      es.close();
    };
  }, [spaceId]);

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
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
        </CardTitle>
        <div className="flex items-center gap-1 text-xs">
          <ModeButton active={mode === 'pretty'} onClick={() => setMode('pretty')}>
            Pretty
          </ModeButton>
          <ModeButton active={mode === 'raw'} onClick={() => setMode('raw')}>
            Raw
          </ModeButton>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-md h-80 overflow-y-auto p-3 font-mono text-xs leading-relaxed"
        >
          {lines.length === 0 ? (
            <p className="text-muted-foreground">
              {isRunning
                ? 'Waiting for events…'
                : 'No attempt in progress. Click "Tick now" above.'}
            </p>
          ) : mode === 'pretty' ? (
            lines.map((l, i) => <LogLineRow key={i} line={l} />)
          ) : (
            lines.map((l, i) => (
              <pre
                key={i}
                className="select-text whitespace-pre-wrap break-all border-b border-neutral-200/40 px-1 py-0.5 text-[11px] leading-snug text-neutral-700 last:border-0 dark:border-neutral-800/40 dark:text-neutral-300"
              >
                {JSON.stringify(l)}
              </pre>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-0.5',
        active
          ? 'bg-secondary text-secondary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
