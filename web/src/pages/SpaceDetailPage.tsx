import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  AgentAccountPublic,
  AgentProviderInfo,
  ResolveAttempt,
  Space,
} from '@jir/shared';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LiveLogsPanel } from '@/components/LiveLogsPanel';

type TickState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'error'; message: string };

type AssignState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string };

const inputClass =
  'rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function SpaceDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [space, setSpace] = useState<Space | null>(null);
  const [attempts, setAttempts] = useState<ResolveAttempt[]>([]);
  const [accounts, setAccounts] = useState<AgentAccountPublic[]>([]);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tickState, setTickState] = useState<TickState>({ kind: 'idle' });
  const [assignState, setAssignState] = useState<AssignState>({ kind: 'idle' });
  const [pickedAccountId, setPickedAccountId] = useState<string>('');
  const [pickedModel, setPickedModel] = useState<string>('');

  async function loadAttempts(spaceId: string): Promise<ResolveAttempt[]> {
    const res = await fetch(`/api/spaces/${spaceId}/resolve-attempts`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ResolveAttempt[];
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/spaces/${id}`).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Space;
      }),
      loadAttempts(id),
      fetch('/api/agent-accounts').then(async (r) =>
        r.ok ? ((await r.json()) as AgentAccountPublic[]) : [],
      ),
      fetch('/api/agent-providers').then(async (r) =>
        r.ok ? ((await r.json()) as AgentProviderInfo[]) : [],
      ),
    ])
      .then(([s, a, accts, p]) => {
        if (cancelled) return;
        setSpace(s);
        setAttempts(a);
        setAccounts(accts);
        setProviders(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function onPickAccount(accountId: string): void {
    setPickedAccountId(accountId);
    const account = accounts.find((a) => a.id === accountId);
    const provider = account ? providers.find((p) => p.id === account.provider) : undefined;
    setPickedModel(provider?.models[0] ?? '');
  }

  async function onAssign(): Promise<void> {
    if (!id || !pickedAccountId || !pickedModel) return;
    setAssignState({ kind: 'saving' });
    try {
      const res = await fetch(`/api/spaces/${id}/account`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentAccountId: pickedAccountId, agentModel: pickedModel }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string } | Space;
      if (!res.ok) {
        setAssignState({
          kind: 'error',
          message: (data as { error?: string }).error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setSpace(data as Space);
      setAssignState({ kind: 'idle' });
    } catch (err) {
      setAssignState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onTickNow(): Promise<void> {
    if (!id) return;
    setTickState({ kind: 'running' });
    try {
      const res = await fetch(`/api/spaces/${id}/loop/tick-now`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setTickState({ kind: 'error', message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setAttempts(await loadAttempts(id));
      setTickState({ kind: 'idle' });
    } catch (err) {
      setTickState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const account = space?.agentAccountId
    ? accounts.find((a) => a.id === space.agentAccountId)
    : undefined;
  const pickedAccount = pickedAccountId
    ? accounts.find((a) => a.id === pickedAccountId)
    : undefined;
  const pickedProvider = pickedAccount
    ? providers.find((p) => p.id === pickedAccount.provider)
    : undefined;
  const pickedModels = pickedProvider?.models ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        to="/"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-3 w-3" /> Spaces
      </Link>

      {loadError && <p className="text-destructive mt-6 text-sm">Failed to load: {loadError}</p>}

      {!loadError && !space && <p className="text-muted-foreground mt-6 text-sm">Loading…</p>}

      {space && (
        <>
          <header className="mt-4 mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">{space.name}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {space.githubRepoUrl} · Jira project {space.jiraProject}
              {account && (
                <>
                  {' '}· Account {account.name} ({space.agentModel})
                </>
              )}
            </p>
          </header>

          {!space.agentAccountId && (
            <div className="border-border bg-card mb-8 rounded-lg border p-4 text-sm">
              <div className="mb-3 font-medium">No agent account assigned</div>
              <p className="text-muted-foreground mb-3 text-xs">
                Pick an account to enable ticks. Add new ones in the{' '}
                <Link to="/agents" className="text-primary hover:underline">
                  Agents
                </Link>{' '}
                page.
              </p>
              {accounts.length === 0 ? (
                <p className="text-muted-foreground text-xs">No accounts configured yet.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={pickedAccountId}
                    onChange={(e) => onPickAccount(e.target.value)}
                    className={inputClass}
                  >
                    <option value="" disabled>
                      Pick an account…
                    </option>
                    {accounts.map((a) => {
                      const p = providers.find((pp) => pp.id === a.provider);
                      return (
                        <option key={a.id} value={a.id}>
                          {a.name} — {p?.label ?? a.provider}
                        </option>
                      );
                    })}
                  </select>
                  <select
                    value={pickedModel}
                    onChange={(e) => setPickedModel(e.target.value)}
                    className={inputClass}
                    disabled={pickedModels.length === 0}
                  >
                    {pickedModels.length === 0 && (
                      <option value="" disabled>
                        Model…
                      </option>
                    )}
                    {pickedModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={onAssign}
                    disabled={
                      !pickedAccountId || !pickedModel || assignState.kind === 'saving'
                    }
                  >
                    {assignState.kind === 'saving' ? 'Saving…' : 'Assign'}
                  </Button>
                  {assignState.kind === 'error' && (
                    <span className="text-destructive text-xs">{assignState.message}</span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mb-8 flex items-center gap-3">
            <Button
              onClick={onTickNow}
              disabled={tickState.kind === 'running' || !space.agentAccountId}
              title={!space.agentAccountId ? 'Assign an agent account first' : undefined}
            >
              {tickState.kind === 'running' ? 'Ticking…' : 'Tick now'}
            </Button>
            {tickState.kind === 'error' && (
              <span className="text-destructive text-sm">{tickState.message}</span>
            )}
          </div>

          <section className="mb-8">
            <LiveLogsPanel spaceId={space.id} />
          </section>

          <h2 className="mb-3 text-base font-semibold">Resolve attempts</h2>
          {attempts.length === 0 ? (
            <div className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
              No attempts yet. Click "Tick now" to pull matching Jira issues.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr className="border-border border-b">
                  <th className="py-2 text-left font-medium">Issue</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-left font-medium">PR</th>
                  <th className="py-2 text-left font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id} className="border-border border-b last:border-b-0">
                    <td className="py-2 font-mono text-xs">
                      {a.issueKey}
                      {a.attemptNumber > 1 && (
                        <span className="text-muted-foreground ml-1.5">#{a.attemptNumber}</span>
                      )}
                    </td>
                    <td className="py-2 text-xs">
                      {a.status}
                      {a.transitionWarning && (
                        <span
                          className="text-muted-foreground ml-1.5 cursor-help text-[10px]"
                          title={a.transitionWarning}
                        >
                          ⚠ Jira
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-xs">
                      {a.prUrl && a.prNumber !== null ? (
                        <a
                          href={a.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          #{a.prNumber}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="text-muted-foreground py-2 text-xs">
                      {new Date(a.startedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
