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
  createdAt: string;
  updatedAt: string;
};

export type JiraSettings = {
  email: string | null;
  redactedToken: string | null;
  baseUrl: string | null;
  connected: boolean;
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
  | 'FAILED';

export const TERMINAL_STATUSES: ReadonlyArray<AttemptStatus> = [
  'FINISHED',
  'FINISHED_NO_CHANGES',
  'FAILED',
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
  startedAt: string;
  endedAt: string | null;
};
