import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  AgentAccountPublic,
  AgentProviderInfo,
  JiraSettings,
  ResolveAttempt,
  Space,
} from '@jir/shared';
import { isTerminal } from '@jir/shared';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  Pencil,
  Play,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AttemptStatusPill } from '@/components/ui/attempt-status-pill';
import { LoopStatusPill } from '@/components/ui/loop-status-pill';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LiveLogsPanel } from '@/components/LiveLogsPanel';
import { cn } from '@/lib/utils';

const inputClass =
  'rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

type IssueGroup = { issueKey: string; attempts: ResolveAttempt[] };

type GroupedResponse = {
  groups: IssueGroup[];
  total: number;
  page: number;
  pageSize: number;
};

type TickState = { kind: 'idle' } | { kind: 'running' } | { kind: 'error'; message: string };
type LoopState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string };
type AssignState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string };

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
// 250ms feels snappy for local-network search-as-you-type. Lower would
// thrash the API on every keystroke; higher feels laggy.
const SEARCH_DEBOUNCE_MS = 250;

async function fetchGroupedAttempts(
  spaceId: string,
  page: number,
  pageSize: number,
  search: string,
): Promise<GroupedResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set('search', search);
  const res = await fetch(`/api/spaces/${spaceId}/resolve-attempts?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as GroupedResponse;
}

export function SpaceDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [space, setSpace] = useState<Space | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[1]);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchActive, setSearchActive] = useState('');
  const [grouped, setGrouped] = useState<GroupedResponse | null>(null);
  const [accounts, setAccounts] = useState<AgentAccountPublic[]>([]);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Initial load: space + agent accounts + providers + Jira settings (for
  // baseUrl). The attempt list is loaded by its own effect so changing
  // page / search / pageSize doesn't refetch any of the above.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/spaces/${id}`).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Space;
      }),
      fetch('/api/agent-accounts').then(async (r) =>
        r.ok ? ((await r.json()) as AgentAccountPublic[]) : [],
      ),
      fetch('/api/agent-providers').then(async (r) =>
        r.ok ? ((await r.json()) as AgentProviderInfo[]) : [],
      ),
      fetch('/api/settings/jira').then(async (r) =>
        r.ok ? ((await r.json()) as JiraSettings) : { baseUrl: null },
      ),
    ])
      .then(([s, accts, p, jira]) => {
        if (cancelled) return;
        setSpace(s);
        setAccounts(accts);
        setProviders(p);
        setJiraBaseUrl(jira.baseUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Debounced search → activeSearch. Resets page=0 whenever the search
  // changes so we don't end up paging into an empty result.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchActive(searchDraft.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const loadAttempts = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      setGrouped(await fetchGroupedAttempts(id, page, pageSize, searchActive));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [id, page, pageSize, searchActive]);

  // Refetch on any pagination/search change.
  useEffect(() => {
    void loadAttempts();
  }, [loadAttempts]);

  // Live-refresh while any visible attempt is non-terminal: poll the
  // grouped list every 2s so status pills (e.g. AGENT_RUNNING →
  // FINISHED) update without the user having to reload. Stops as soon
  // as every visible attempt is terminal. Cadence picked to be cheap
  // (one paginated query) and quick enough to feel "live."
  useEffect(() => {
    if (!grouped) return;
    const hasInFlight = grouped.groups.some((g) => g.attempts.some((a) => !isTerminal(a.status)));
    if (!hasInFlight) return;
    const t = setInterval(() => void loadAttempts(), 2000);
    return () => clearInterval(t);
  }, [grouped, loadAttempts]);

  function onChangePageSize(next: number): void {
    setPageSize(next);
    setPage(0);
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Crumb to="/" label="Spaces" />
        <Card className="mt-6 border-red-300 dark:border-red-900">
          <CardContent className="pt-6">
            <p className="text-red-600">Failed to load: {loadError}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!space) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Crumb to="/" label="Spaces" />
        <p className="text-muted-foreground mt-6 text-sm">Loading…</p>
      </main>
    );
  }

  const account = space.agentAccountId
    ? accounts.find((a) => a.id === space.agentAccountId)
    : undefined;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
      <Crumb to="/" label="Spaces" />

      <SpaceHeader space={space} account={account} />

      {!space.agentAccountId && (
        <AssignAccountCard
          spaceId={space.id}
          accounts={accounts}
          providers={providers}
          onAssigned={setSpace}
        />
      )}

      <LoopControlCard space={space} setSpace={setSpace} onTicked={loadAttempts} />

      <LiveLogsPanel spaceId={space.id} />

      <section>
        <h2 className="mb-3 text-base font-semibold">Resolve attempts</h2>
        <AttemptsList
          grouped={grouped}
          page={page}
          pageSize={pageSize}
          searchDraft={searchDraft}
          jiraBaseUrl={jiraBaseUrl}
          onSearchChange={setSearchDraft}
          onPageChange={setPage}
          onPageSizeChange={onChangePageSize}
          onAttemptDeleted={loadAttempts}
        />
      </section>
    </main>
  );
}

// ───────────────────────────── header + crumb ───────────────────────────

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

function SpaceHeader({
  space,
  account,
}: {
  space: Space;
  account: AgentAccountPublic | undefined;
}): React.ReactElement {
  const navigate = useNavigate();
  return (
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{space.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {space.githubRepoUrl} · Jira project {space.jiraProject}
          {account && (
            <>
              {' '}· Account {account.name} ({space.agentModel})
            </>
          )}
        </p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(`/space/${space.id}/edit`)}
            aria-label="Edit Space"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit Space</TooltipContent>
      </Tooltip>
    </header>
  );
}

// ───────────────────────── assignment card ──────────────────────────────

function AssignAccountCard({
  spaceId,
  accounts,
  providers,
  onAssigned,
}: {
  spaceId: string;
  accounts: AgentAccountPublic[];
  providers: AgentProviderInfo[];
  onAssigned: (s: Space) => void;
}): React.ReactElement {
  const [state, setState] = useState<AssignState>({ kind: 'idle' });
  const [pickedAccountId, setPickedAccountId] = useState('');
  const [pickedModel, setPickedModel] = useState('');

  function onPickAccount(accountId: string): void {
    setPickedAccountId(accountId);
    const account = accounts.find((a) => a.id === accountId);
    const provider = account ? providers.find((p) => p.id === account.provider) : undefined;
    setPickedModel(provider?.models[0] ?? '');
  }

  async function onAssign(): Promise<void> {
    if (!pickedAccountId || !pickedModel) return;
    setState({ kind: 'saving' });
    try {
      const res = await fetch(`/api/spaces/${spaceId}/account`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentAccountId: pickedAccountId, agentModel: pickedModel }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string } | Space;
      if (!res.ok) {
        setState({
          kind: 'error',
          message: (data as { error?: string }).error ?? `HTTP ${res.status}`,
        });
        return;
      }
      onAssigned(data as Space);
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const pickedAccount = accounts.find((a) => a.id === pickedAccountId);
  const pickedProvider = pickedAccount
    ? providers.find((p) => p.id === pickedAccount.provider)
    : undefined;
  const pickedModels = pickedProvider?.models ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>No agent account assigned</CardTitle>
      </CardHeader>
      <CardContent>
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
              disabled={!pickedAccountId || !pickedModel || state.kind === 'saving'}
            >
              {state.kind === 'saving' ? 'Saving…' : 'Assign'}
            </Button>
            {state.kind === 'error' && (
              <span className="text-destructive text-xs">{state.message}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────── loop control card ────────────────────────────

function LoopControlCard({
  space,
  setSpace,
  onTicked,
}: {
  space: Space;
  setSpace: (s: Space) => void;
  onTicked: () => Promise<void>;
}): React.ReactElement {
  const [tickState, setTickState] = useState<TickState>({ kind: 'idle' });
  const [loopState, setLoopState] = useState<LoopState>({ kind: 'idle' });

  async function onToggleLoop(): Promise<void> {
    setLoopState({ kind: 'busy' });
    const path = space.loopRunning ? 'stop' : 'start';
    try {
      const res = await fetch(`/api/spaces/${space.id}/loop/${path}`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { error?: string } | Space;
      if (!res.ok) {
        setLoopState({
          kind: 'error',
          message: (data as { error?: string }).error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setSpace(data as Space);
      setLoopState({ kind: 'idle' });
    } catch (err) {
      setLoopState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function onTickNow(): Promise<void> {
    setTickState({ kind: 'running' });
    try {
      const res = await fetch(`/api/spaces/${space.id}/loop/tick-now`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setTickState({ kind: 'error', message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      await onTicked();
      setTickState({ kind: 'idle' });
    } catch (err) {
      setTickState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const disabled = !space.agentAccountId;
  const disabledHint = disabled ? 'Assign an agent account first' : undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <CardTitle>Resolve loop</CardTitle>
          <LoopStatusPill running={space.loopRunning} />
          <span className="text-muted-foreground text-xs">
            every {space.tickIntervalSeconds}s
          </span>
          {space.lastTickAt && (
            <span className="text-muted-foreground text-xs">
              · last tick {new Date(space.lastTickAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={disabled ? 'cursor-not-allowed' : undefined}>
                <Button
                  onClick={onToggleLoop}
                  disabled={loopState.kind === 'busy' || disabled}
                  variant={space.loopRunning ? 'destructive' : 'success'}
                  className="gap-1.5"
                >
                  {space.loopRunning ? (
                    <Square className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                  {loopState.kind === 'busy'
                    ? space.loopRunning
                      ? 'Stopping…'
                      : 'Starting…'
                    : space.loopRunning
                      ? 'Stop loop'
                      : 'Start loop'}
                </Button>
              </span>
            </TooltipTrigger>
            {disabledHint && <TooltipContent>{disabledHint}</TooltipContent>}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className={disabled ? 'cursor-not-allowed' : undefined}>
                <Button
                  variant="outline"
                  onClick={onTickNow}
                  disabled={tickState.kind === 'running' || disabled}
                >
                  {tickState.kind === 'running' ? 'Ticking…' : 'Tick now'}
                </Button>
              </span>
            </TooltipTrigger>
            {disabledHint && <TooltipContent>{disabledHint}</TooltipContent>}
          </Tooltip>
        </div>
        {(loopState.kind === 'error' || tickState.kind === 'error') && (
          <p className="text-destructive mt-2 text-xs">
            {loopState.kind === 'error' && loopState.message}
            {tickState.kind === 'error' && tickState.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────── attempts list ────────────────────────────────

function AttemptsList({
  grouped,
  page,
  pageSize,
  searchDraft,
  jiraBaseUrl,
  onSearchChange,
  onPageChange,
  onPageSizeChange,
  onAttemptDeleted,
}: {
  grouped: GroupedResponse | null;
  page: number;
  pageSize: number;
  searchDraft: string;
  jiraBaseUrl: string | null;
  onSearchChange: (s: string) => void;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  onAttemptDeleted: () => void | Promise<void>;
}): React.ReactElement {
  const total = grouped?.total ?? 0;
  const visibleCount = grouped?.groups.length ?? 0;
  const firstIdx = total === 0 ? 0 : page * pageSize + 1;
  const lastIdx = page * pageSize + visibleCount;
  const hasNext = lastIdx < total;
  const hasPrev = page > 0;

  return (
    <div className="space-y-3">
      <FilterBar
        searchDraft={searchDraft}
        pageSize={pageSize}
        onSearchChange={onSearchChange}
        onPageSizeChange={onPageSizeChange}
      />

      {grouped === null ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : grouped.groups.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground text-sm">
              {searchDraft
                ? `No issues match "${searchDraft}".`
                : 'No attempts yet. Click "Tick now" to pull matching Jira issues.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        grouped.groups.map((g) => (
          <IssueGroupCard
            key={g.issueKey}
            group={g}
            jiraBaseUrl={jiraBaseUrl}
            onAttemptDeleted={onAttemptDeleted}
          />
        ))
      )}

      {total > 0 && (
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>
            Showing {firstIdx}–{lastIdx} of {total} issue{total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!hasPrev}
              onClick={() => onPageChange(Math.max(0, page - 1))}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasNext}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterBar({
  searchDraft,
  pageSize,
  onSearchChange,
  onPageSizeChange,
}: {
  searchDraft: string;
  pageSize: number;
  onSearchChange: (s: string) => void;
  onPageSizeChange: (n: number) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
        <input
          type="search"
          value={searchDraft}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by issue key (e.g. RND-7050)…"
          className={cn(inputClass, 'w-full pl-8')}
        />
      </div>
      <select
        value={pageSize}
        onChange={(e) => onPageSizeChange(Number(e.target.value))}
        className={inputClass}
        aria-label="Issues per page"
      >
        {PAGE_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n} per page
          </option>
        ))}
      </select>
    </div>
  );
}

function IssueGroupCard({
  group,
  jiraBaseUrl,
  onAttemptDeleted,
}: {
  group: IssueGroup;
  jiraBaseUrl: string | null;
  onAttemptDeleted: () => void | Promise<void>;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [latest, ...priors] = group.attempts;
  if (!latest) return <></>;

  const hasPriors = priors.length > 0;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <Card>
      {/* Card header: issue identity + chevron to reveal priors. The
          per-attempt rows below are uniform — same columns for the
          headline (latest) and each prior. */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <JiraIssueLink issueKey={group.issueKey} jiraBaseUrl={jiraBaseUrl} />
        {hasPriors ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Collapse history' : 'Expand history'}
                className="cursor-pointer rounded p-1 text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100"
              >
                <Chevron className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {expanded ? 'Hide' : 'Show'} {priors.length} prior attempt
              {priors.length === 1 ? '' : 's'}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground text-xs">single attempt</span>
        )}
      </div>

      <AttemptRow attempt={latest} onDeleted={onAttemptDeleted} onStopped={onAttemptDeleted} />
      {expanded &&
        priors.map((p) => (
          <div key={p.id} className="border-t border-border/40">
            <AttemptRow attempt={p} onDeleted={onAttemptDeleted} onStopped={onAttemptDeleted} />
          </div>
        ))}
    </Card>
  );
}

// Issue key as a link to the live Jira ticket. Falls back to plain text
// when Jira settings haven't been configured yet (baseUrl is null).
function JiraIssueLink({
  issueKey,
  jiraBaseUrl,
}: {
  issueKey: string;
  jiraBaseUrl: string | null;
}): React.ReactElement {
  if (!jiraBaseUrl) {
    return <span className="font-mono text-sm font-semibold">{issueKey}</span>;
  }
  // Strip a trailing slash so the URL doesn't end up `//browse/...`.
  const base = jiraBaseUrl.replace(/\/$/, '');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={`${base}/browse/${encodeURIComponent(issueKey)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1"
        >
          {issueKey}
          <ExternalLink className="h-3 w-3 opacity-60" />
        </a>
      </TooltipTrigger>
      <TooltipContent>Open {issueKey} in Jira</TooltipContent>
    </Tooltip>
  );
}

// Uniform attempt row used for both the headline (latest) and priors:
// `attempt #N | status (+warn) | time | PR | view | stop | delete`
function AttemptRow({
  attempt,
  onDeleted,
  onStopped,
}: {
  attempt: ResolveAttempt;
  onDeleted: () => void | Promise<void>;
  onStopped: () => void | Promise<void>;
}): React.ReactElement {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const canDelete = isTerminal(attempt.status);
  // "Running" = past QUEUED and not yet terminal. Per the per-Space
  // serial scheduler, only one attempt per Space is in this band at a
  // time, and only it has an AbortController registered. QUEUED rows
  // would 400 `not_running` if stopped — so we don't render the
  // button for them.
  const isRunning = !canDelete && attempt.status !== 'QUEUED';

  async function onDelete(): Promise<void> {
    const ok = window.confirm(`Delete attemp #${attempt.attemptNumber}? Its history is still accessible by direct URL.`);
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/resolve-attempts/${attempt.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(`Delete failed: ${body.error ?? `HTTP ${res.status}`}`);
        setDeleting(false);
        return;
      }
      onDeleted();
    } catch (err) {
      window.alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
      setDeleting(false);
    }
  }

  async function onStop(): Promise<void> {
    const ok = window.confirm(`Stop attempt #${attempt.attemptNumber}? It will be marked FAILED.`);
    if (!ok) return;
    setStopping(true);
    try {
      const res = await fetch(`/api/resolve-attempts/${attempt.id}/stop`, { method: 'POST' });
      if (!res.ok && res.status !== 202) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(`Stop failed: ${body.error ?? `HTTP ${res.status}`}`);
        setStopping(false);
        return;
      }
      // The orchestrator transitions to FAILED at its next checkpoint
      // (typically <2s). The parent's auto-refresh poll picks that up
      // and re-renders this row with the terminal status; we don't
      // need to wait synchronously.
      onStopped();
      setStopping(false);
    } catch (err) {
      window.alert(`Stop failed: ${err instanceof Error ? err.message : String(err)}`);
      setStopping(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="text-muted-foreground w-24 shrink-0 text-xs">
        attempt #{attempt.attemptNumber}
      </span>

      <div className="flex flex-1 items-center gap-2">
        <AttemptStatusPill status={attempt.status} />
        {attempt.status === 'FAILED' && attempt.errorReason && (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle className="h-3.5 w-3.5 cursor-help text-red-600 dark:text-red-400" />
            </TooltipTrigger>
            <TooltipContent className="max-w-md">{attempt.errorReason}</TooltipContent>
          </Tooltip>
        )}
        {attempt.transitionWarning && (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle className="h-3.5 w-3.5 cursor-help text-amber-600 dark:text-amber-400" />
            </TooltipTrigger>
            <TooltipContent>Jira: {attempt.transitionWarning}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <span className="text-muted-foreground shrink-0 text-xs">
        {new Date(attempt.startedAt).toLocaleString()}
      </span>

      <div className="flex shrink-0 items-center gap-2">
        <PrLink attempt={attempt} />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => navigate(`/resolve-attempts/${attempt.id}`)}
              aria-label="View attempt logs"
              className="cursor-pointer rounded p-1.5 text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100"
            >
              <Eye className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>View logs</TooltipContent>
        </Tooltip>
        {isRunning && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onStop}
                disabled={stopping}
                aria-label="Stop attempt"
                className="cursor-pointer rounded p-1.5 text-neutral-500 hover:bg-amber-100/60 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-500 dark:text-neutral-400 dark:hover:bg-amber-950/40 dark:hover:text-amber-400"
              >
                <Square className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Stop attempt</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onDelete}
              disabled={!canDelete || deleting}
              aria-label="Delete attempt"
              className="cursor-pointer rounded p-1.5 text-neutral-500 hover:bg-red-100/60 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-500 dark:text-neutral-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {canDelete ? 'Delete attempt' : 'Stop the attempt first before deleting it'}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function PrLink({ attempt }: { attempt: ResolveAttempt }): React.ReactElement {
  if (!attempt.prUrl || attempt.prNumber === null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <a
      href={attempt.prUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-emerald-700 hover:underline dark:text-emerald-400 inline-flex items-center gap-1 text-xs"
    >
      PR #{attempt.prNumber}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
