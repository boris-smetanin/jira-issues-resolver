import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { HistoricalLog, ResolveAttempt } from '@jir/shared';
import { isTerminal } from '@jir/shared';
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

// Slice 14: `historyStatus` mirrors the API's discriminator so the
// empty-state copy can distinguish swept-by-retention from never-wrote.
type LogState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; lines: LogLine[]; historyStatus: HistoricalLog['status'] };

// Slice 15: state for the Stop / Delete button on the header.
//   - idle: button enabled
//   - stopping: POST sent; polling /resolve-attempts/:id until terminal
//   - deleting: DELETE sent; navigating back to the Space on success
//   - error:    last action failed; user can retry
type ActionState =
  | { kind: 'idle' }
  | { kind: 'stopping' }
  | { kind: 'deleting' }
  | { kind: 'error'; action: 'stop' | 'delete'; message: string };

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
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logState, setLogState] = useState<LogState>({ kind: 'loading' });
  const [logMode, setLogMode] = useState<'pretty' | 'raw'>('pretty');
  // Slice 15: progress flags for the Stop / Hide buttons in the header.
  const [actionState, setActionState] = useState<ActionState>({ kind: 'idle' });

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
        const payload = (await res.json()) as HistoricalLog;
        const lines: LogLine[] = [];
        for (const raw of payload.text.split('\n')) {
          const line = raw.trim();
          if (!line) continue;
          try {
            lines.push(JSON.parse(line) as LogLine);
          } catch {
            // skip malformed
          }
        }
        if (cancelled) return;
        setLogState({ kind: 'ok', lines, historyStatus: payload.status });
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

  async function onStop(): Promise<void> {
    const ok = window.confirm('Stop this attempt? It will be marked FAILED.');
    if (!ok) return;
    setActionState({ kind: 'stopping' });
    try {
      const res = await fetch(`/api/resolve-attempts/${attempt.id}/stop`, { method: 'POST' });
      if (!res.ok && res.status !== 202) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Poll for the terminal flip — orchestrator observes the abort
      // at the next checkpoint, typically <2s. Cap at 30s in case
      // Sandcastle is slow to cancel a stuck subprocess; user can
      // refresh manually after that.
      await pollUntilTerminal(attempt.id, 30_000, (next) => setDetail((d) => (d ? { ...d, attempt: next } : d)));
      setActionState({ kind: 'idle' });
    } catch (err) {
      setActionState({
        kind: 'error',
        action: 'stop',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onDelete(): Promise<void> {
    const ok = window.confirm(`Delete attemp #${attempt.attemptNumber}? Its history is still accessible by direct URL.`);
    if (!ok) return;
    setActionState({ kind: 'deleting' });
    try {
      const res = await fetch(`/api/resolve-attempts/${attempt.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      navigate(`/space/${attempt.spaceId}`);
    } catch (err) {
      setActionState({
        kind: 'error',
        action: 'delete',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
          {live ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onStop}
              disabled={actionState.kind === 'stopping'}
            >
              {actionState.kind === 'stopping' ? 'Stopping…' : 'Stop attempt'}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              disabled={actionState.kind === 'deleting'}
              className="text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            >
              <Trash2 className="h-4 w-4" />
              {actionState.kind === 'deleting' ? 'Deleting…' : 'Delete'}
            </Button>
          )}
        </div>
      </header>

      {actionState.kind === 'error' && (
        <Card className="border-red-300 dark:border-red-900">
          <CardContent className="pt-6 text-sm text-red-700 dark:text-red-300">
            {actionState.action === 'stop' ? 'Stop' : 'Delete'} failed: {actionState.message}
          </CardContent>
        </Card>
      )}

      {attempt.status === 'FAILED' && <FailureCard attempt={attempt} />}
      {attempt.status === 'ESCALATED' && <EscalationCard attempt={attempt} />}
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

// Slice 16b: render the agent's escalation write-up (from
// `.jir/escalation.md`) on the per-attempt detail page. The write-up
// has already been mirrored to the Jira issue as a comment + the issue
// labelled `agent-escalated`; this card lets the developer review the
// agent's reasoning without leaving the resolver UI.
function EscalationCard({ attempt }: { attempt: ResolveAttempt }): React.ReactElement {
  return (
    <Card className="border-violet-300 dark:border-violet-900">
      <CardHeader>
        <CardTitle className="text-violet-700 dark:text-violet-300">
          Agent escalation — human input needed
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground text-xs">
          The agent decided it couldn&apos;t safely commit a fix and wrote up its reasoning.
          A Jira comment has been posted on the issue and the <code>agent-escalated</code>{' '}
          label was added so the loop won&apos;t re-spawn an attempt on this issue. Remove the
          label after you&apos;ve addressed it to make the issue eligible again.
        </p>
        {attempt.escalationMd ? (
          <pre className="max-h-[40rem] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs leading-relaxed text-neutral-800 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 whitespace-pre-wrap">
            {attempt.escalationMd}
          </pre>
        ) : (
          <p className="text-muted-foreground">(escalation write-up not captured)</p>
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
        <Cell label="Shape">
          {attempt.promptShape ? (
            <PromptShapeBadge shape={attempt.promptShape} />
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
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

// Slice 16b: small coloured pill identifying which prompt shape was
// dispatched for this attempt.
function PromptShapeBadge({
  shape,
}: {
  shape: 'bug' | 'code-improvement' | 'feature';
}): React.ReactElement {
  const style =
    shape === 'bug'
      ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
      : shape === 'code-improvement'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  const label = shape === 'code-improvement' ? 'code-improvement' : shape;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {label}
    </span>
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

// Slice 14: pick the right empty-state copy based on the API status.
//   - expired: row points at a log file that no longer exists on disk
//     (retention sweeper deleted it). The attempt itself ran fine.
//   - absent:  row never had a logFilePath (very early attempt from
//     before the NDJSON logger was wired in slice 7).
//   - ok + live: the attempt just started and hasn't flushed lines yet.
//   - ok + terminal: ran but emitted no parsable lines (rare).
function emptyLogMessage(
  state: Extract<LogState, { kind: 'ok' }>,
  live: boolean,
): string {
  if (state.historyStatus === 'expired') {
    return '(logs expired — this attempt is older than the configured retention window)';
  }
  if (state.historyStatus === 'absent') {
    return 'No log file was recorded for this attempt.';
  }
  return live
    ? 'Log file is empty — the attempt is just starting.'
    : 'No log lines for this attempt.';
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
    return <p className="text-muted-foreground text-sm">{emptyLogMessage(state, live)}</p>;
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

// Slice 15: poll the attempt until it reaches a terminal state, so the
// header status pill flips after a Stop click without the user needing
// to refresh. Sleeps 1.5s between polls; gives up at `timeoutMs` (the
// orchestrator's checkpoint cadence is usually <2s so the cap is just
// defensive in case Sandcastle is slow to cancel a stuck subprocess).
async function pollUntilTerminal(
  attemptId: string,
  timeoutMs: number,
  onTick: (a: ResolveAttempt) => void,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`/api/resolve-attempts/${attemptId}`);
    if (!res.ok) continue;
    const body = (await res.json()) as { attempt: ResolveAttempt };
    onTick(body.attempt);
    if (isTerminal(body.attempt.status)) return;
  }
}
