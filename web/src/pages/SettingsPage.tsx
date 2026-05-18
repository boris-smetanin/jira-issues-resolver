import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { JiraSettings } from '@jir/shared';
import { Button } from '@/components/ui/button';

const TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens';

type FormState = { email: string; apiToken: string; baseUrl: string };
type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; connectedAs: string }
  | { kind: 'error'; message: string };

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function SettingsPage(): React.ReactElement {
  const [settings, setSettings] = useState<JiraSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ email: '', apiToken: '', baseUrl: '' });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/jira')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as JiraSettings;
        if (cancelled) return;
        setSettings(data);
        setForm({ email: data.email ?? '', apiToken: '', baseUrl: data.baseUrl ?? '' });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/settings/jira', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as { connectedAs?: string; error?: string };
      if (!res.ok) {
        setStatus({ kind: 'error', message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setStatus({ kind: 'success', connectedAs: data.connectedAs ?? '' });
      const refreshed = (await fetch('/api/settings/jira').then((r) => r.json())) as JiraSettings;
      setSettings(refreshed);
      setForm((s) => ({ ...s, apiToken: '' }));
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Jira credentials are shared across all Spaces.
        </p>
      </header>

      {loadError !== null && (
        <p className="text-destructive text-sm">Failed to load settings: {loadError}</p>
      )}

      {settings === null && loadError === null && (
        <p className="text-muted-foreground text-sm">Loading…</p>
      )}

      {settings !== null && (
        <>
          {settings.connected ? (
            <div className="border-border bg-card mb-6 rounded-lg border p-4 text-sm">
              <div className="font-medium">Connected to Jira</div>
              <div className="text-muted-foreground mt-1">
                {settings.email} · {settings.baseUrl} · token {settings.redactedToken}
              </div>
            </div>
          ) : (
            <div className="border-border text-muted-foreground mb-6 rounded-lg border border-dashed p-4 text-sm">
              Jira credentials not configured.
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Site URL</label>
              <input
                type="url"
                required
                placeholder="https://mycompany.atlassian.net"
                value={form.baseUrl}
                onChange={(e) => setForm((s) => ({ ...s, baseUrl: e.target.value }))}
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                required
                placeholder="you@company.com"
                value={form.email}
                onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                className={inputClass}
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium">API token</label>
                <a
                  href={TOKEN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                >
                  mint a token <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <input
                type="password"
                required
                value={form.apiToken}
                onChange={(e) => setForm((s) => ({ ...s, apiToken: e.target.value }))}
                className={inputClass}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={status.kind === 'saving'}>
                {status.kind === 'saving' ? 'Verifying…' : 'Save'}
              </Button>
              {status.kind === 'success' && (
                <span className="text-muted-foreground text-sm">
                  Connected as {status.connectedAs}
                </span>
              )}
              {status.kind === 'error' && (
                <span className="text-destructive text-sm">{status.message}</span>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
