import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ResolveAttempt } from '@jir/shared';
import { isTerminal } from '@jir/shared';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AttemptStatusPill } from '@/components/ui/attempt-status-pill';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LogLineRow, type LogLine } from '@/components/log-line';
import { cn } from '@/lib/utils';

type DetailResponse = {
  attempt: ResolveAttempt;
  priors: ResolveAttempt[];
  next: ResolveAttempt | null;
};

type LogState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; lines: LogLine[] };

function durationMs(startIso: string, endIso: string | null): number {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return Math.max(0, end - start);
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

export function ResolveAttemptDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logState, setLogState] = useState<LogState>({ kind: 'loading' });
  const [logMode, setLogMode] = useState<'pretty' | 'raw'>('pretty');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    fetch(`/api/resolve-attempts/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as DetailResponse;
      })
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        return loadLog(d.attempt);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });

    async function loadLog(attempt: ResolveAttempt): Promise<void> {
      try {
        const res = await fetch(
          `/api/spaces/${attempt.spaceId}/resolve-attempts/${attempt.id}/logs`,
        );
        if (!res.ok) {
          if (cancelled) return;
          setLogState({ kind: 'error', message: `HTTP ${res.status}` });
          return;
        }
        const text = await res.text();
        const lines: LogLine[] = [];
        for (const raw of text.split('\n')) {
          const line = raw.trim();
          if (!line) continue;
          try {
            lines.push(JSON.parse(line) as LogLine);
          } catch {
            // skip malformed
          }
        }
        if (cancelled) return;
        setLogState({ kind: 'ok', lines });
      } catch (err) {
        if (cancelled) return;
        setLogState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loadError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link
          to="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-3 w-3" /> Spaces
        </Link>
        <Card className="mt-6 border-red-300 dark:border-red-900">
          <CardContent className="pt-6">
            <p className="text-red-600">Failed to load: {loadError}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    );
  }

  const { attempt } = detail;
  const live = !isTerminal(attempt.status);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
      <Link
        to={`/space/${attempt.spaceId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-3 w-3" /> Back to Space
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            {attempt.issueKey}
            <span className="text-muted-foreground ml-2 font-sans text-base">
              attempt #{attempt.attemptNumber}
            </span>
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">{attempt.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <AttemptStatusPill status={attempt.status} />
          {live && (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              live
            </span>
          )}
        </div>
      </header>

      {attempt.status === 'FAILED' && <FailureCard attempt={attempt} />}
      {attempt.transitionWarning && (
        <Card className="border-amber-300 dark:border-amber-900">
          <CardHeader>
            <CardTitle className="text-amber-700 dark:text-amber-300">
              Jira transition warning
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-amber-700 dark:text-amber-400">{attempt.transitionWarning}</p>
            <p className="text-muted-foreground mt-2 text-xs">
              The PR is open but the Jira issue's status was not updated. The agent's job
              completed; you may need to transition the issue manually.
            </p>
          </CardContent>
        </Card>
      )}

      <MetadataCard attempt={attempt} />

      <PromptCard attempt={attempt} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>Log</CardTitle>
          {logState.kind === 'ok' && logState.lines.length > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <ModeButton active={logMode === 'pretty'} onClick={() => setLogMode('pretty')}>
                Pretty
              </ModeButton>
              <ModeButton active={logMode === 'raw'} onClick={() => setLogMode('raw')}>
                Raw
              </ModeButton>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <LogPane state={logState} mode={logMode} live={live} />
        </CardContent>
      </Card>
    </main>
  );
}

// ───────────────────────────── subcomponents ────────────────────────────

function FailureCard({ attempt }: { attempt: ResolveAttempt }): React.ReactElement {
  return (
    <Card className="border-red-300 dark:border-red-900">
      <CardHeader>
        <CardTitle className="text-red-700 dark:text-red-300">
          Failed{attempt.stuckAtStatus ? ` at ${attempt.stuckAtStatus}` : ''}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {attempt.errorReason && (
          <p className="text-neutral-700 dark:text-neutral-300">{attempt.errorReason}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MetadataCard({ attempt }: { attempt: ResolveAttempt }): React.ReactElement {
  const duration = formatDuration(durationMs(attempt.startedAt, attempt.endedAt));
  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm md:grid-cols-4">
        <Cell label="Branch">
          <span className="font-mono text-xs">{attempt.branchName ?? '—'}</span>
        </Cell>
        <Cell label="PR">
          {attempt.prUrl && attempt.prNumber !== null ? (
            <a
              href={attempt.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 hover:underline dark:text-emerald-400 inline-flex items-center gap-1"
            >
              #{attempt.prNumber}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Cell>
        <Cell label="Started">{new Date(attempt.startedAt).toLocaleString()}</Cell>
        <Cell label={attempt.endedAt ? 'Duration' : 'Running for'}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help">{duration}</span>
            </TooltipTrigger>
            <TooltipContent>
              {attempt.endedAt
                ? `Ended ${new Date(attempt.endedAt).toLocaleString()}`
                : 'Still in-flight'}
            </TooltipContent>
          </Tooltip>
        </Cell>
      </CardContent>
    </Card>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function PromptCard({ attempt }: { attempt: ResolveAttempt }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt sent to the agent</CardTitle>
      </CardHeader>
      <CardContent>
        {attempt.promptRendered === null ? (
          <p className="text-muted-foreground text-sm">
            (no prompt recorded for this attempt)
          </p>
        ) : (
          <pre className="max-h-[40rem] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs leading-relaxed text-neutral-800 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 whitespace-pre-wrap">
            {attempt.promptRendered}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function LogPane({
  state,
  mode,
  live,
}: {
  state: LogState;
  mode: 'pretty' | 'raw';
  live: boolean;
}): React.ReactElement {
  if (state.kind === 'loading') {
    return <p className="text-muted-foreground text-sm">Loading log…</p>;
  }
  if (state.kind === 'error') {
    return <p className="text-destructive text-sm">Failed to load log: {state.message}</p>;
  }
  if (state.lines.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {live
          ? 'Log file is empty — the attempt is just starting.'
          : 'No log lines for this attempt.'}
      </p>
    );
  }
  return (
    <div className="max-h-[40rem] overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs leading-relaxed dark:border-neutral-800 dark:bg-neutral-950">
      {mode === 'pretty'
        ? state.lines.map((line, i) => <LogLineRow key={i} line={line} />)
        : state.lines.map((line, i) => (
            <pre
              key={i}
              className="select-text whitespace-pre-wrap break-all border-b border-neutral-200/40 px-1 py-0.5 text-[11px] leading-snug text-neutral-700 last:border-0 dark:border-neutral-800/40 dark:text-neutral-300"
            >
              {JSON.stringify(line)}
            </pre>
          ))}
    </div>
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
