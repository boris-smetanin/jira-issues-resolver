import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  AgentAccountPublic,
  AgentProviderInfo,
  FilterField,
  Space,
} from '@jir/shared';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Slice 10 polish: edit a Space's non-identity / non-creds fields with ONE
// big Save. The github URL + token are not editable here — the URL would
// orphan the existing clone, the token gets its own rotate flow later.
// Everything else (agent account, model, tick interval, JQL filter,
// committer identity, allowed statuses, agent labels) lives in this form.

type FormState = {
  name: string;
  baseBranch: string;
  githubCommitterName: string;
  githubCommitterEmail: string;
  agentAccountId: string;
  agentModel: string;
  tickIntervalSeconds: string; // string so the input can be temporarily empty
  jiraProject: string;
  filterField: FilterField;
  filterValue: string;
  allowedStatusesText: string;
  agentLabelsText: string;
  targetStatusName: string;
};

type Status =
  | { kind: 'loading' }
  | { kind: 'load-error'; message: string }
  | { kind: 'editing' }
  | { kind: 'saving' }
  | { kind: 'save-error'; message: string; field?: string };

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function spaceToForm(s: Space): FormState {
  return {
    name: s.name,
    baseBranch: s.baseBranch,
    githubCommitterName: s.githubCommitterName,
    githubCommitterEmail: s.githubCommitterEmail,
    agentAccountId: s.agentAccountId ?? '',
    agentModel: s.agentModel,
    tickIntervalSeconds: String(s.tickIntervalSeconds),
    jiraProject: s.jiraProject,
    filterField: s.filterField,
    filterValue: s.filterValue,
    allowedStatusesText: s.allowedStatuses.join(', '),
    agentLabelsText: s.agentLabels.join(', '),
    targetStatusName: s.targetStatusName,
  };
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function EditSpacePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState | null>(null);
  const [accounts, setAccounts] = useState<AgentAccountPublic[]>([]);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  // Load Space + agent accounts + providers in parallel. Bail if any of the
  // three fail — none of them are optional for editing.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/spaces/${id}`).then(async (r) => {
        if (!r.ok) throw new Error(`/spaces/${id}: HTTP ${r.status}`);
        return (await r.json()) as Space;
      }),
      fetch('/api/agent-accounts').then(async (r) => {
        if (!r.ok) throw new Error(`/agent-accounts: HTTP ${r.status}`);
        return (await r.json()) as AgentAccountPublic[];
      }),
      fetch('/api/agent-providers').then(async (r) => {
        if (!r.ok) throw new Error(`/agent-providers: HTTP ${r.status}`);
        return (await r.json()) as AgentProviderInfo[];
      }),
    ])
      .then(([s, a, p]) => {
        if (cancelled) return;
        setForm(spaceToForm(s));
        setAccounts(a);
        setProviders(p);
        setStatus({ kind: 'editing' });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus({
            kind: 'load-error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((s) => (s ? { ...s, [key]: value } : s));
  }

  // When the user picks a different account, prefer keeping the current
  // model if the new provider also supports it; otherwise drop to the
  // provider's first model.
  function onPickAccount(accountId: string): void {
    const account = accounts.find((a) => a.id === accountId);
    const provider = account
      ? providers.find((p) => p.id === account.provider)
      : undefined;
    setForm((s) => {
      if (!s) return s;
      const models = provider?.models ?? [];
      const nextModel = models.includes(s.agentModel) ? s.agentModel : (models[0] ?? '');
      return { ...s, agentAccountId: accountId, agentModel: nextModel };
    });
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!id || !form) return;
    const interval = Number.parseInt(form.tickIntervalSeconds, 10);
    if (!Number.isFinite(interval) || interval < 30 || interval > 3600) {
      setStatus({
        kind: 'save-error',
        message: 'Tick interval must be between 30 and 3600 seconds',
        field: 'tickIntervalSeconds',
      });
      return;
    }
    setStatus({ kind: 'saving' });
    const body = {
      name: form.name,
      baseBranch: form.baseBranch,
      githubCommitterName: form.githubCommitterName,
      githubCommitterEmail: form.githubCommitterEmail,
      agentAccountId: form.agentAccountId,
      agentModel: form.agentModel,
      tickIntervalSeconds: interval,
      jiraProject: form.jiraProject,
      filterField: form.filterField,
      filterValue: form.filterValue,
      allowedStatuses: splitList(form.allowedStatusesText),
      agentLabels: splitList(form.agentLabelsText),
      targetStatusName: form.targetStatusName,
    };
    try {
      const res = await fetch(`/api/spaces/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as
        | { error?: string; field?: string }
        | Space;
      if (!res.ok) {
        const err = data as { error?: string; field?: string };
        setStatus({
          kind: 'save-error',
          message: err.error ?? `HTTP ${res.status}`,
          ...(err.field ? { field: err.field } : {}),
        });
        return;
      }
      navigate(`/space/${id}`);
    } catch (err) {
      setStatus({
        kind: 'save-error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (status.kind === 'loading') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Crumb to={id ? `/space/${id}` : '/'} label="Back to Space" />
        <p className="text-muted-foreground mt-6 text-sm">Loading…</p>
      </main>
    );
  }
  if (status.kind === 'load-error') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Crumb to={id ? `/space/${id}` : '/'} label="Back to Space" />
        <Card className="mt-6 border-red-300 dark:border-red-900">
          <CardContent className="pt-6">
            <p className="text-red-600">Failed to load: {status.message}</p>
          </CardContent>
        </Card>
      </main>
    );
  }
  if (!form) return <></>;

  const saving = status.kind === 'saving';
  const currentAccount = accounts.find((a) => a.id === form.agentAccountId);
  const currentProvider = currentAccount
    ? providers.find((p) => p.id === currentAccount.provider)
    : undefined;
  const availableModels = currentProvider?.models ?? [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <Crumb to={id ? `/space/${id}` : '/'} label="Back to Space" />

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Edit Space</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Identity (GitHub repo URL + token) isn't edited here — those have
          their own flows. Everything else is one Save.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Base branch">
              <input
                value={form.baseBranch}
                onChange={(e) => set('baseBranch', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Committer name">
              <input
                value={form.githubCommitterName}
                onChange={(e) => set('githubCommitterName', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Committer email">
              <input
                type="email"
                value={form.githubCommitterEmail}
                onChange={(e) => set('githubCommitterEmail', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field
              label="Account"
              hint={
                accounts.length === 0
                  ? 'No accounts configured yet. Add one in the Agents page first.'
                  : undefined
              }
            >
              <select
                value={form.agentAccountId}
                onChange={(e) => onPickAccount(e.target.value)}
                className={inputClass}
                disabled={accounts.length === 0}
                required
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
            </Field>
            <Field
              label="Model"
              hint={
                availableModels.length === 0 && form.agentAccountId
                  ? 'This provider exposes no models yet.'
                  : undefined
              }
            >
              <select
                value={form.agentModel}
                onChange={(e) => set('agentModel', e.target.value)}
                className={inputClass}
                disabled={availableModels.length === 0}
                required
              >
                {availableModels.length === 0 && (
                  <option value="" disabled>
                    Model…
                  </option>
                )}
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Tick interval (seconds)"
              hint="How often the Resolve loop polls Jira when running. Between 30 and 3600."
            >
              <input
                type="number"
                min={30}
                max={3600}
                value={form.tickIntervalSeconds}
                onChange={(e) => set('tickIntervalSeconds', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jira filter</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Project key" hint="e.g. RND, ABC">
              <input
                value={form.jiraProject}
                onChange={(e) => set('jiraProject', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Filter field">
              <select
                value={form.filterField}
                onChange={(e) => set('filterField', e.target.value as FilterField)}
                className={inputClass}
              >
                <option value="component">component</option>
                <option value="labels">labels</option>
                <option value="fixVersion">fixVersion</option>
              </select>
            </Field>
            <Field label="Filter value">
              <input
                value={form.filterValue}
                onChange={(e) => set('filterValue', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field
              label="Allowed statuses"
              hint="Comma-separated. The agent ticks issues in any of these states."
            >
              <input
                value={form.allowedStatusesText}
                onChange={(e) => set('allowedStatusesText', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field
              label="Agent labels"
              hint="Comma-separated. Issues must carry at least one of these labels."
            >
              <input
                value={form.agentLabelsText}
                onChange={(e) => set('agentLabelsText', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field
              label="Target Jira status"
              hint="The status to transition the issue to after the PR opens."
            >
              <input
                value={form.targetStatusName}
                onChange={(e) => set('targetStatusName', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
          </CardContent>
        </Card>

        {status.kind === 'save-error' && (
          <Card className="border-red-300 dark:border-red-900">
            <CardContent className="pt-6">
              <p className="text-red-600">
                {status.field ? `${status.field}: ` : ''}
                {status.message}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-end gap-2">
          <Link to={id ? `/space/${id}` : '/'}>
            <Button type="button" variant="outline" disabled={saving}>
              Cancel
            </Button>
          </Link>
          <Button type="submit" variant="success" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </main>
  );
}

function Crumb({ to, label }: { to: string; label: string }): React.ReactElement {
  return (
    <Link
      to={to}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft className="h-3 w-3" /> {label}
    </Link>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </label>
  );
}
