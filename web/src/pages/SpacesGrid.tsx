import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Space } from '@jir/shared';
import { MoreVertical, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoopStatusPill } from '@/components/ui/loop-status-pill';

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
        <Card className="border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm">
            No spaces yet. Create your first Space to start draining Jira issues.
          </p>
        </Card>
      )}

      {state.kind === 'ok' && state.spaces.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.spaces.map((s) => (
            <SpaceCard
              key={s.id}
              space={s}
              onDeleted={() =>
                setState((prev) =>
                  prev.kind === 'ok'
                    ? { kind: 'ok', spaces: prev.spaces.filter((x) => x.id !== s.id) }
                    : prev,
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// Slice 15: per-card overflow menu with "Delete" (soft-delete the
// Space). The whole card is still a Link, so the menu button has to
// stop propagation — otherwise clicking "..." navigates into the
// Space detail page.
function SpaceCard({
  space,
  onDeleted,
}: {
  space: Space;
  onDeleted: () => void;
}): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click-outside dismiss. Cheap enough that we don't bother with a
  // ref-counted listener or a portal.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  async function onDelete(e: React.MouseEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    const ok = window.confirm(
      'Hide this Space? Attempt history will remain accessible by URL but the Space won\'t appear in the grid.',
    );
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${space.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <li className="relative">
      <Link to={`/space/${space.id}`} className="block">
        <Card className="hover:bg-accent p-4 transition-colors">
          <div className="text-sm font-medium pr-8">{space.name}</div>
          <div className="text-muted-foreground mt-1 truncate text-xs">
            {space.githubRepoUrl}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs">
            <LoopStatusPill running={space.loopRunning} />
            <span className="text-muted-foreground">
              {space.lastTickAt
                ? `last tick ${new Date(space.lastTickAt).toLocaleTimeString()}`
                : 'never ticked'}
            </span>
          </div>
          {error && <p className="text-destructive mt-2 text-xs">Delete failed: {error}</p>}
        </Card>
      </Link>

      <div ref={menuRef} className="absolute top-2 right-2">
        <button
          type="button"
          aria-label="Space actions"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="hover:bg-muted text-muted-foreground rounded p-1"
          disabled={deleting}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="bg-popover absolute right-0 mt-1 w-32 rounded-md border shadow-md">
            <button
              type="button"
              onClick={onDelete}
              className="text-destructive hover:bg-accent block w-full px-3 py-2 text-left text-sm"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
