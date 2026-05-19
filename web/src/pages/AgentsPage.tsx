import { useEffect, useState } from 'react';
import type { AgentAccountPublic, AgentProviderInfo } from '@jir/shared';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type AddForm = { provider: string; name: string; apiKey: string };
type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; field?: string; message: string };

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function AgentsPage(): React.ReactElement {
  const [accounts, setAccounts] = useState<AgentAccountPublic[]>([]);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AddForm>({ provider: '', name: '', apiKey: '' });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function load(): Promise<void> {
    const [accountRes, provRes] = await Promise.all([
      fetch('/api/agent-accounts'),
      fetch('/api/agent-providers'),
    ]);
    if (!accountRes.ok) throw new Error(`/agent-accounts: HTTP ${accountRes.status}`);
    if (!provRes.ok) throw new Error(`/agent-providers: HTTP ${provRes.status}`);
    setAccounts((await accountRes.json()) as AgentAccountPublic[]);
    setProviders((await provRes.json()) as AgentProviderInfo[]);
  }

  useEffect(() => {
    let cancelled = false;
    load().catch((err: unknown) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledProviders = providers.filter((p) => p.enabled);

  function openAdd(): void {
    setForm({ provider: enabledProviders[0]?.id ?? '', name: '', apiKey: '' });
    setStatus({ kind: 'idle' });
    setAdding(true);
  }

  async function onAdd(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/agent-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: string;
      };
      if (!res.ok) {
        setStatus({
          kind: 'error',
          field: data.field,
          message: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      await load();
      setAdding(false);
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onDelete(id: string, label: string): Promise<void> {
    if (!confirm(`Delete account "${label}"?`)) return;
    try {
      const res = await fetch(`/api/agent-accounts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? `Delete failed: HTTP ${res.status}`);
        return;
      }
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent accounts</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            API keys for each agent provider. Stored encrypted with the project's MASTER_KEY.
          </p>
        </div>
        {!adding && (
          <Button onClick={openAdd}>
            <Plus />
            Add
          </Button>
        )}
      </header>

      {loadError && <p className="text-destructive text-sm">Failed to load: {loadError}</p>}

      {adding && (
        <form
          onSubmit={onAdd}
          className="border-border bg-card mb-6 space-y-4 rounded-lg border p-4"
        >
          <h2 className="text-base font-semibold">New account</h2>
          <div>
            <label className="mb-1 block text-sm font-medium">Provider</label>
            <select
              value={form.provider}
              onChange={(e) => setForm((s) => ({ ...s, provider: e.target.value }))}
              className={inputClass}
              required
            >
              {enabledProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              {providers
                .filter((p) => !p.enabled)
                .map((p) => (
                  <option key={p.id} value={p.id} disabled>
                    {p.label} (not yet enabled)
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              required
              value={form.name}
              placeholder="Personal Anthropic"
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              className={inputClass}
            />
            {status.kind === 'error' && status.field === 'name' && (
              <p className="text-destructive mt-1 text-xs">{status.message}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">API key</label>
            <input
              required
              type="password"
              value={form.apiKey}
              placeholder="sk-ant-..."
              onChange={(e) => setForm((s) => ({ ...s, apiKey: e.target.value }))}
              className={inputClass}
            />
            {status.kind === 'error' && status.field === 'apiKey' && (
              <p className="text-destructive mt-1 text-xs">{status.message}</p>
            )}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={status.kind === 'saving'}>
              {status.kind === 'saving' ? 'Validating…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setStatus({ kind: 'idle' });
              }}
            >
              Cancel
            </Button>
            {status.kind === 'error' && !status.field && (
              <span className="text-destructive text-sm">{status.message}</span>
            )}
          </div>
        </form>
      )}

      {accounts.length === 0 && !adding ? (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          No accounts yet. Click "Add" to register an agent API key.
        </div>
      ) : (
        <ul className="space-y-2">
          {accounts.map((a) => {
            const provider = providers.find((p) => p.id === a.provider);
            return (
              <li
                key={a.id}
                className="border-border bg-card flex items-center justify-between rounded-lg border p-4"
              >
                <div>
                  <div className="text-sm font-medium">{a.name}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {provider?.label ?? a.provider} · key {a.redactedKey}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive p-1.5"
                  onClick={() => onDelete(a.id, a.name)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
