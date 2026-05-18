export type SpaceId = string;

export type Space = {
  id: SpaceId;
  name: string;
};

export type JiraSettings = {
  email: string | null;
  redactedToken: string | null;
  baseUrl: string | null;
  connected: boolean;
};
