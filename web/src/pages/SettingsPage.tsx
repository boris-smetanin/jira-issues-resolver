import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { IssueTypeMap, JiraSettings, LogRetentionSettings } from '@jir/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens';

type JiraForm = { email: string; apiToken: string; baseUrl: string };
type JiraStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; connectedAs: string }
  | { kind: 'error'; message: string };

// One textarea per shape. The form keeps text (comma-separated); we
// split into a `string[]` on submit. Empty entries are dropped at the
// service layer (DTO rejects empty arrays — caught client-side too).
type IssueTypeForm = { bug: string; codeImprovement: string; feature: string };
type IssueTypeStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

// Slice 14: keep retention input as a string so partial typing ("3")
// doesn't snap back to 0 before submit. Parse + validate on submit.
type LogRetentionForm = { days: string };
type LogRetentionStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function joinList(xs: string[]): string {
  return xs.join(', ');
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function SettingsPage(): React.ReactElement {
  const [settings, setSettings] = useState<JiraSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jiraForm, setJiraForm] = useState<JiraForm>({ email: '', apiToken: '', baseUrl: '' });
  const [jiraStatus, setJiraStatus] = useState<JiraStatus>({ kind: 'idle' });

  const [issueTypeForm, setIssueTypeForm] = useState<IssueTypeForm | null>(null);
  const [issueTypeStatus, setIssueTypeStatus] = useState<IssueTypeStatus>({ kind: 'idle' });

  const [retentionForm, setRetentionForm] = useState<LogRetentionForm | null>(null);
  const [retentionStatus, setRetentionStatus] = useState<LogRetentionStatus>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/settings/jira').then(async (r) => {
        if (!r.ok) throw new Error(`/settings/jira: HTTP ${r.status}`);
        return (await r.json()) as JiraSettings;
      }),
      fetch('/api/settings/issue-type-map').then(async (r) => {
        if (!r.ok) throw new Error(`/settings/issue-type-map: HTTP ${r.status}`);
        return (await r.json()) as IssueTypeMap;
      }),
      fetch('/api/settings/log-retention').then(async (r) => {
        if (!r.ok) throw new Error(`/settings/log-retention: HTTP ${r.status}`);
        return (await r.json()) as LogRetentionSettings;
      }),
    ])
      .then(([jiraData, mapData, retentionData]) => {
        if (cancelled) return;
        setSettings(jiraData);
        setJiraForm({
          email: jiraData.email ?? '',
          apiToken: '',
          baseUrl: jiraData.baseUrl ?? '',
        });
        setIssueTypeForm({
          bug: joinList(mapData.bug),
          codeImprovement: joinList(mapData.codeImprovement),
          feature: joinList(mapData.feature),
        });
        setRetentionForm({ days: String(retentionData.days) });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onJiraSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setJiraStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/settings/jira', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jiraForm),
      });
      const data = (await res.json().catch(() => ({}))) as {
        connectedAs?: string;
        error?: string;
      };
      if (!res.ok) {
        setJiraStatus({ kind: 'error', message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setJiraStatus({ kind: 'success', connectedAs: data.connectedAs ?? '' });
      const refreshed = (await fetch('/api/settings/jira').then((r) => r.json())) as JiraSettings;
      setSettings(refreshed);
      setJiraForm((s) => ({ ...s, apiToken: '' }));
    } catch (err) {
      setJiraStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function onRetentionSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!retentionForm) return;
    const days = Number(retentionForm.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setRetentionStatus({ kind: 'error', message: 'Days must be an integer between 1 and 365.' });
      return;
    }
    setRetentionStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/settings/log-retention', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | LogRetentionSettings
        | { field?: string; error?: string };
      if (!res.ok) {
        const err = data as { field?: string; error?: string };
        setRetentionStatus({
          kind: 'error',
          message: err.field ? `${err.field}: ${err.error}` : (err.error ?? `HTTP ${res.status}`),
        });
        return;
      }
      const saved = data as LogRetentionSettings;
      setRetentionForm({ days: String(saved.days) });
      setRetentionStatus({ kind: 'success' });
    } catch (err) {
      setRetentionStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onIssueTypeSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!issueTypeForm) return;
    const body: IssueTypeMap = {
      bug: splitList(issueTypeForm.bug),
      codeImprovement: splitList(issueTypeForm.codeImprovement),
      feature: splitList(issueTypeForm.feature),
    };
    if (body.bug.length === 0 || body.codeImprovement.length === 0 || body.feature.length === 0) {
      setIssueTypeStatus({
        kind: 'error',
        message: 'Each shape must have at least one issue type configured.',
      });
      return;
    }
    setIssueTypeStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/settings/issue-type-map', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as
        | IssueTypeMap
        | { field?: string; error?: string };
      if (!res.ok) {
        const err = data as { field?: string; error?: string };
        setIssueTypeStatus({
          kind: 'error',
          message: err.field ? `${err.field}: ${err.error}` : (err.error ?? `HTTP ${res.status}`),
        });
        return;
      }
      const saved = data as IssueTypeMap;
      setIssueTypeForm({
        bug: joinList(saved.bug),
        codeImprovement: joinList(saved.codeImprovement),
        feature: joinList(saved.feature),
      });
      setIssueTypeStatus({ kind: 'success' });
    } catch (err) {
      setIssueTypeStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Global configuration — applies to every Space.
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
          {/* ─── Jira credentials ──────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Jira credentials</CardTitle>
            </CardHeader>
            <CardContent>
              {settings.connected ? (
                <div className="text-muted-foreground mb-4 text-sm">
                  Connected as {settings.email} · {settings.baseUrl} · token{' '}
                  {settings.redactedToken}
                </div>
              ) : (
                <div className="text-muted-foreground mb-4 text-sm">
                  Not yet configured.
                </div>
              )}

              <form onSubmit={onJiraSubmit} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">Site URL</label>
                  <input
                    type="url"
                    required
                    placeholder="https://mycompany.atlassian.net"
                    value={jiraForm.baseUrl}
                    onChange={(e) => setJiraForm((s) => ({ ...s, baseUrl: e.target.value }))}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">Email</label>
                  <input
                    type="email"
                    required
                    placeholder="you@company.com"
                    value={jiraForm.email}
                    onChange={(e) => setJiraForm((s) => ({ ...s, email: e.target.value }))}
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
                    value={jiraForm.apiToken}
                    onChange={(e) => setJiraForm((s) => ({ ...s, apiToken: e.target.value }))}
                    className={inputClass}
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button type="submit" variant="success" disabled={jiraStatus.kind === 'saving'}>
                    {jiraStatus.kind === 'saving' ? 'Verifying…' : 'Save'}
                  </Button>
                  {jiraStatus.kind === 'success' && (
                    <span className="text-muted-foreground text-sm">
                      Connected as {jiraStatus.connectedAs}
                    </span>
                  )}
                  {jiraStatus.kind === 'error' && (
                    <span className="text-destructive text-sm">{jiraStatus.message}</span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          {/* ─── Issue-type → prompt-shape map ─────────────────────────── */}
          {issueTypeForm !== null && (
            <Card>
              <CardHeader>
                <CardTitle>Issue type → prompt shape</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4 text-xs">
                  Which Jira issue types get routed to which prompt shape. The resolver only
                  fetches issues whose type is in one of these lists — unrecognised types are
                  excluded at the JQL level. Edit if your Jira project uses different names
                  (e.g. <code>Defect</code> instead of <code>Bug</code>). Comma-separated.
                </p>

                <form onSubmit={onIssueTypeSubmit} className="space-y-4">
                  <Field label="Bug-shaped (hypothesis-driven, root-cause)">
                    <input
                      value={issueTypeForm.bug}
                      onChange={(e) =>
                        setIssueTypeForm((s) => (s ? { ...s, bug: e.target.value } : s))
                      }
                      className={inputClass}
                      required
                    />
                  </Field>

                  <Field label="Code-improvement-shaped (preserve behaviour, refactor scope)">
                    <input
                      value={issueTypeForm.codeImprovement}
                      onChange={(e) =>
                        setIssueTypeForm((s) =>
                          s ? { ...s, codeImprovement: e.target.value } : s,
                        )
                      }
                      className={inputClass}
                      required
                    />
                  </Field>

                  <Field label="Feature-shaped (scope, interface-first, no over-engineering)">
                    <input
                      value={issueTypeForm.feature}
                      onChange={(e) =>
                        setIssueTypeForm((s) => (s ? { ...s, feature: e.target.value } : s))
                      }
                      className={inputClass}
                      required
                    />
                  </Field>

                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      type="submit"
                      variant="success"
                      disabled={issueTypeStatus.kind === 'saving'}
                    >
                      {issueTypeStatus.kind === 'saving' ? 'Saving…' : 'Save'}
                    </Button>
                    {issueTypeStatus.kind === 'success' && (
                      <span className="text-muted-foreground text-sm">Saved.</span>
                    )}
                    {issueTypeStatus.kind === 'error' && (
                      <span className="text-destructive text-sm">{issueTypeStatus.message}</span>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* ─── Log retention (slice 14) ───────────────────────────────── */}
          {retentionForm !== null && (
            <Card>
              <CardHeader>
                <CardTitle>Log retention</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4 text-xs">
                  How many days of per-attempt NDJSON log files to keep on disk. An hourly sweeper
                  deletes older files; the attempt history row stays (the Log tab shows{' '}
                  <em>(logs expired)</em>). Default 30, range 1–365.
                </p>
                <form onSubmit={onRetentionSubmit} className="space-y-4">
                  <Field label="Days">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={retentionForm.days}
                      onChange={(e) => setRetentionForm({ days: e.target.value })}
                      className={inputClass}
                      required
                    />
                  </Field>
                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      type="submit"
                      variant="success"
                      disabled={retentionStatus.kind === 'saving'}
                    >
                      {retentionStatus.kind === 'saving' ? 'Saving…' : 'Save'}
                    </Button>
                    {retentionStatus.kind === 'success' && (
                      <span className="text-muted-foreground text-sm">Saved.</span>
                    )}
                    {retentionStatus.kind === 'error' && (
                      <span className="text-destructive text-sm">{retentionStatus.message}</span>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
