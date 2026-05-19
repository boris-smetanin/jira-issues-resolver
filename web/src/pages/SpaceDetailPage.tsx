import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ResolveAttempt, Space } from '@jir/shared';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

type TickState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'error'; message: string };

export function SpaceDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [space, setSpace] = useState<Space | null>(null);
  const [attempts, setAttempts] = useState<ResolveAttempt[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tickState, setTickState] = useState<TickState>({ kind: 'idle' });

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
    ])
      .then(([s, a]) => {
        if (cancelled) return;
        setSpace(s);
        setAttempts(a);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
            </p>
          </header>

          <div className="mb-8 flex items-center gap-3">
            <Button onClick={onTickNow} disabled={tickState.kind === 'running'}>
              {tickState.kind === 'running' ? 'Ticking…' : 'Tick now'}
            </Button>
            {tickState.kind === 'error' && (
              <span className="text-destructive text-sm">{tickState.message}</span>
            )}
          </div>

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
                    <td className="py-2 text-xs">{a.status}</td>
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
