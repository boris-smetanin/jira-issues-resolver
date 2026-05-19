import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  AgentAccountPublic,
  AgentProviderInfo,
  FilterField,
  Space,
} from '@jir/shared';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

type FormState = {
  name: string;
  githubRepoUrl: string;
  githubToken: string;
  githubCommitterName: string;
  githubCommitterEmail: string;
  baseBranch: string;
  agentAccountId: string;
  agentModel: string;
  jiraProject: string;
  filterField: FilterField;
  filterValue: string;
  allowedStatusesText: string;
  agentLabelsText: string;
  targetStatusName: string;
  tickIntervalSeconds: number;
};

const initialState: FormState = {
  name: '',
  githubRepoUrl: '',
  githubToken: '',
  githubCommitterName: '',
  githubCommitterEmail: '',
  baseBranch: 'main',
  agentAccountId: '',
  agentModel: '',
  jiraProject: '',
  filterField: 'labels',
  filterValue: '',
  allowedStatusesText: '',
  agentLabelsText: 'queued, reopen',
  targetStatusName: 'Code Review',
  tickIntervalSeconds: 300,
};

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string; field?: string };

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function NewSpacePage(): React.ReactElement {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initialState);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [accounts, setAccounts] = useState<AgentAccountPublic[]>([]);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/agent-accounts').then(async (r) => {
        if (!r.ok) throw new Error(`/agent-accounts: HTTP ${r.status}`);
        return (await r.json()) as AgentAccountPublic[];
      }),
      fetch('/api/agent-providers').then(async (r) => {
        if (!r.ok) throw new Error(`/agent-providers: HTTP ${r.status}`);
        return (await r.json()) as AgentProviderInfo[];
      }),
    ])
      .then(([a, p]) => {
        if (cancelled) return;
        setAccounts(a);
        setProviders(p);
        // Pre-select first account + its first model if any exist.
        if (a.length > 0) {
          const first = a[0]!;
          const firstProvider = p.find((pp) => pp.id === first.provider);
          setForm((s) => ({
            ...s,
            agentAccountId: first.id,
            agentModel: firstProvider?.models[0] ?? '',
          }));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setBootstrapError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((s) => ({ ...s, [key]: value }));
  }

  function onAccountChange(accountId: string): void {
    const account = accounts.find((a) => a.id === accountId);
    const provider = account ? providers.find((p) => p.id === account.provider) : undefined;
    setForm((s) => ({
      ...s,
      agentAccountId: accountId,
      agentModel: provider?.models[0] ?? '',
    }));
  }

  const selectedAccount = accounts.find((a) => a.id === form.agentAccountId);
  const selectedProvider = selectedAccount
    ? providers.find((p) => p.id === selectedAccount.provider)
    : undefined;
  const availableModels = selectedProvider?.models ?? [];

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus({ kind: 'saving' });

    // Comma-separated, not whitespace-separated — Jira statuses can have
    // spaces ("In Progress", "Code Review").
    const splitCsv = (s: string): string[] =>
      s
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    const allowedStatuses = splitCsv(form.allowedStatusesText);
    const agentLabels = splitCsv(form.agentLabelsText);

    const body = {
      name: form.name,
      githubRepoUrl: form.githubRepoUrl,
      githubToken: form.githubToken,
      githubCommitterName: form.githubCommitterName,
      githubCommitterEmail: form.githubCommitterEmail,
      baseBranch: form.baseBranch,
      agentAccountId: form.agentAccountId,
      agentModel: form.agentModel,
      jiraProject: form.jiraProject,
      filterField: form.filterField,
      filterValue: form.filterValue,
      allowedStatuses,
      agentLabels,
      targetStatusName: form.targetStatusName,
      tickIntervalSeconds: form.tickIntervalSeconds,
    };

    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        field?: string;
        error?: string;
      };
      if (!res.ok) {
        setStatus({
          kind: 'error',
          message: data.error ?? `HTTP ${res.status}`,
          field: data.field,
        });
        return;
      }
      const space = data as Space;
      navigate(`/space/${space.id}`);
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link
        to="/"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-3 w-3" /> Spaces
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">New Space</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Each Space ties a GitHub repo to a Jira filter. The server runs five sync validations on
          save.
        </p>
      </header>

      {bootstrapError && (
        <p className="text-destructive mb-6 text-sm">Failed to load: {bootstrapError}</p>
      )}

      {accounts.length === 0 && !bootstrapError && (
        <div className="border-border text-muted-foreground mb-6 rounded-lg border border-dashed p-6 text-sm">
          You need at least one agent account before creating a Space.{' '}
          <Link to="/agents" className="text-primary hover:underline">
            Add one in the Agents page
          </Link>
          .
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-8">
        <Section title="Identity">
          <Field label="Name">
            <input
              required
              value={form.name}
              onChange={(e) => patch('name', e.target.value)}
              className={inputClass}
              placeholder="ongage-backend"
            />
          </Field>
        </Section>

        <Section title="Jira filter">
          <Field label="Project key" hint="The uppercase project prefix, e.g. RND.">
            <input
              required
              value={form.jiraProject}
              onChange={(e) => patch('jiraProject', e.target.value.toUpperCase())}
              className={inputClass}
              placeholder="RND"
            />
          </Field>
          <Field label="Filter field">
            <select
              value={form.filterField}
              onChange={(e) => patch('filterField', e.target.value as FilterField)}
              className={inputClass}
            >
              <option value="component">component</option>
              <option value="labels">labels</option>
              <option value="fixVersion">fixVersion</option>
            </select>
          </Field>
          <Field label="Filter value">
            <input
              required
              value={form.filterValue}
              onChange={(e) => patch('filterValue', e.target.value)}
              className={inputClass}
              placeholder={form.filterField === 'labels' ? 'agent-eligible' : '...'}
            />
          </Field>
          <Field
            label="Allowed statuses"
            hint="Comma-separated. Names can contain spaces (e.g. 'In Progress')."
          >
            <input
              required
              value={form.allowedStatusesText}
              onChange={(e) => patch('allowedStatusesText', e.target.value)}
              className={inputClass}
              placeholder="Open, Reopened, Backlog"
            />
          </Field>
          <Field
            label="Agent labels"
            hint="Comma-separated. At least one must be on the issue for the agent to pick it up. Default: queued, reopen."
          >
            <input
              required
              value={form.agentLabelsText}
              onChange={(e) => patch('agentLabelsText', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field
            label="Target status"
            hint="Jira status the issue is transitioned into after the PR opens."
          >
            <input
              required
              value={form.targetStatusName}
              onChange={(e) => patch('targetStatusName', e.target.value)}
              className={inputClass}
            />
          </Field>
        </Section>

        <Section title="GitHub">
          <Field label="Repo URL" hint="HTTPS only: https://github.com/owner/repo.">
            <input
              required
              type="url"
              value={form.githubRepoUrl}
              onChange={(e) => patch('githubRepoUrl', e.target.value)}
              className={inputClass}
              placeholder="https://github.com/owner/repo"
            />
          </Field>
          <Field label="Personal Access Token">
            <input
              required
              type="password"
              value={form.githubToken}
              onChange={(e) => patch('githubToken', e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Committer name">
              <input
                required
                value={form.githubCommitterName}
                onChange={(e) => patch('githubCommitterName', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Committer email">
              <input
                required
                type="email"
                value={form.githubCommitterEmail}
                onChange={(e) => patch('githubCommitterEmail', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Base branch">
            <input
              required
              value={form.baseBranch}
              onChange={(e) => patch('baseBranch', e.target.value)}
              className={inputClass}
            />
          </Field>
        </Section>

        <Section title="Agent">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account">
              <select
                required
                value={form.agentAccountId}
                onChange={(e) => onAccountChange(e.target.value)}
                className={inputClass}
                disabled={accounts.length === 0}
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
            <Field label="Model">
              <select
                required
                value={form.agentModel}
                onChange={(e) => patch('agentModel', e.target.value)}
                className={inputClass}
                disabled={availableModels.length === 0}
              >
                {availableModels.length === 0 && (
                  <option value="" disabled>
                    Pick an account first
                  </option>
                )}
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Loop">
          <Field
            label="Tick interval (seconds)"
            hint="How often the loop polls Jira. 30–3600. Default 300."
          >
            <input
              required
              type="number"
              min={30}
              max={3600}
              value={form.tickIntervalSeconds}
              onChange={(e) => patch('tickIntervalSeconds', Number(e.target.value))}
              className={inputClass}
            />
          </Field>
        </Section>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={status.kind === 'saving' || accounts.length === 0}>
            {status.kind === 'saving' ? 'Validating…' : 'Create Space'}
          </Button>
          {status.kind === 'error' && (
            <span className="text-destructive text-sm">
              {status.field ? `${status.field}: ` : ''}
              {status.message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      <div className="border-border bg-card space-y-4 rounded-lg border p-4">{children}</div>
    </section>
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
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {hint && <p className="text-muted-foreground mb-1 text-xs">{hint}</p>}
      {children}
    </div>
  );
}
