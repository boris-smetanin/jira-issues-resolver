export type SpaceId = string;
export type AgentProvider = 'claude' | 'codex';
export type AgentRuntimeMode = 'host' | 'container';
export type FilterField = 'component' | 'labels' | 'fixVersion';

export type Space = {
  id: SpaceId;
  name: string;
  githubRepoUrl: string;
  githubCommitterName: string;
  githubCommitterEmail: string;
  baseBranch: string;
  agentAccountId: string | null;
  agentModel: string;
  agentRuntimeMode: AgentRuntimeMode;
  jiraProject: string;
  filterField: FilterField;
  filterValue: string;
  allowedStatuses: string[];
  agentLabels: string[];
  targetStatusName: string;
  tickIntervalSeconds: number;
  loopRunning: boolean;
  lastTickAt: string | null;
  // Slice 11: the per-Space Dockerfile used when `agentRuntimeMode ==
  // 'container'`. Null in host mode. Exposed publicly because the Edit
  // Space UI needs to render it in the Monaco/textarea editor — there
  // are no secrets in a healthy Dockerfile (we explicitly warn the
  // user against BuildKit secrets in the generator).
  dockerfileContent: string | null;
  // Slice 16b: name of the env var the project's .npmrc references
  // (e.g. NPM_REGISTRY_TOKEN). The actual token value lives encrypted
  // server-side and is NEVER exposed in this public type.
  npmrcEnvName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JiraSettings = {
  email: string | null;
  redactedToken: string | null;
  baseUrl: string | null;
  connected: boolean;
};

// Slice 16a: issue-type → prompt-shape map. Used by the Settings page to
// render the three editable lists; sent back on PUT /settings/issue-type-map.
export type IssueTypeMap = {
  bug: string[];
  codeImprovement: string[];
  feature: string[];
};

// Slice 14: log retention (NDJSON sweeper). Server treats the column as
// a positive integer of days; 30 is the default, 1..365 the valid range.
export type LogRetentionSettings = {
  days: number;
};

// Slice 14: GET /spaces/:id/resolve-attempts/:rid/logs response. The
// status discriminator lets the UI distinguish "swept by retention"
// from "attempt never wrote anything" from "really empty file".
export type HistoricalLog = {
  text: string;
  status: 'ok' | 'expired' | 'absent';
};

export type AgentAccountPublic = {
  id: string;
  provider: AgentProvider;
  name: string;
  redactedKey: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentProviderInfo = {
  id: AgentProvider;
  label: string;
  models: string[];
  enabled: boolean;
};

export type AttemptStatus =
  | 'QUEUED'
  | 'PREPARING_REPO'
  | 'AGENT_RUNNING'
  | 'CHECKING_COMMITS'
  | 'PUSHING'
  | 'OPENING_PR'
  | 'TRANSITIONING_JIRA'
  | 'FINISHED'
  | 'FINISHED_NO_CHANGES'
  | 'FAILED'
  | 'ESCALATED';

export type PromptShape = 'bug' | 'code-improvement' | 'feature';

export const TERMINAL_STATUSES: ReadonlyArray<AttemptStatus> = [
  'FINISHED',
  'FINISHED_NO_CHANGES',
  'FAILED',
  'ESCALATED',
];

export function isTerminal(status: AttemptStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export type ResolveAttempt = {
  id: string;
  spaceId: SpaceId;
  issueKey: string;
  attemptNumber: number;
  priorAttemptId: string | null;
  status: AttemptStatus;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  errorReason: string | null;
  stuckAtStatus: string | null;
  transitionWarning: string | null;
  logFilePath: string | null;
  promptRendered: string | null;
  escalationMd: string | null;
  depsInstalledForAttempt: boolean;
  promptShape: PromptShape | null;
  startedAt: string;
  endedAt: string | null;
};
