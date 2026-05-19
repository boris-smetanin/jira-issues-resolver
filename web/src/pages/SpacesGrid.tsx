import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Space } from '@jir/shared';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; spaces: Space[] };

export function SpacesGrid(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/spaces')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Space[];
        if (!cancelled) setState({ kind: 'ok', spaces: data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Spaces</h1>
        <Button onClick={() => navigate('/new')}>
          <Plus />
          New Space
        </Button>
      </header>

      {state.kind === 'loading' && <p className="text-muted-foreground text-sm">Loading…</p>}

      {state.kind === 'error' && (
        <p className="text-destructive text-sm">Failed to load spaces: {state.message}</p>
      )}

      {state.kind === 'ok' && state.spaces.length === 0 && (
        <div className="border-border rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm">
            No spaces yet. Create your first Space to start draining Jira issues.
          </p>
        </div>
      )}

      {state.kind === 'ok' && state.spaces.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.spaces.map((s) => (
            <li key={s.id}>
              <Link
                to={`/space/${s.id}`}
                className="border-border bg-card hover:bg-accent block rounded-lg border p-4 shadow-sm transition-colors"
              >
                <div className="text-sm font-medium">{s.name}</div>
                <div className="text-muted-foreground mt-1 truncate text-xs">
                  {s.githubRepoUrl}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span
                    className={cn(
                      'rounded-md px-2 py-0.5',
                      s.loopRunning
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    Loop {s.loopRunning ? 'on' : 'off'}
                  </span>
                  <span className="text-muted-foreground">0 / 0</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
