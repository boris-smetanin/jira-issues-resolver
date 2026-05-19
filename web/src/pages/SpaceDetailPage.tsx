import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Space } from '@jir/shared';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SpaceDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [space, setSpace] = useState<Space | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`/api/spaces/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as Space;
      })
      .then((s) => {
        if (!cancelled) setSpace(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        to="/"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-3 w-3" /> Spaces
      </Link>

      {error && <p className="text-destructive mt-6 text-sm">Failed to load: {error}</p>}

      {!error && !space && <p className="text-muted-foreground mt-6 text-sm">Loading…</p>}

      {space && (
        <>
          <header className="mt-4 mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">{space.name}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {space.githubRepoUrl} · Jira project {space.jiraProject}
            </p>
          </header>

          <div className="flex gap-2">
            <Button variant="outline" disabled title="wired up in a later slice">
              Verify repo
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
