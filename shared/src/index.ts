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
  agentProvider: AgentProvider;
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
  createdAt: string;
  updatedAt: string;
};

export type JiraSettings = {
  email: string | null;
  redactedToken: string | null;
  baseUrl: string | null;
  connected: boolean;
};
