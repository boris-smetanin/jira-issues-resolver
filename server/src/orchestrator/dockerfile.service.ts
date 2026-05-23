import { existsSync } from 'node:fs';
import { mkdir as fsMkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Space } from '@jir/shared';
import { config as appConfig } from '../core/config.js';
import { cloneRepo, fetchOrigin } from '../integrations/git/git.client.js';
import { findInternalActiveById } from '../spaces/spaces.repository.js';
import { generate, type GenerateResult } from './dockerfile.generator.js';

// Slice 11: orchestrator-side service that wraps the pure
// dockerfile.generator with the I/O bits the API endpoint needs:
// ensure a clone of the Space's repo exists on disk before reading it.
// Mirrors branch.resolver's clone path (same `data/repos/<spaceId>/`
// convention) so the detection sees the same files an attempt would.

export class SpaceNotFoundError extends Error {
  constructor(spaceId: string) {
    super(`Space ${spaceId} not found`);
    this.name = 'SpaceNotFoundError';
  }
}

export async function detectDockerfileForSpace(spaceId: string): Promise<GenerateResult> {
  const space = await findInternalActiveById(spaceId);
  if (!space) throw new SpaceNotFoundError(spaceId);

  const cloneDir = resolve(appConfig.dataDir, 'repos', space.id);

  // Same lazy-clone pattern branch.resolver uses. The clone is shared
  // with future attempts — no need to refetch worktrees or anything
  // expensive for the detect step.
  if (!existsSync(join(cloneDir, '.git'))) {
    await fsMkdir(join(appConfig.dataDir, 'repos'), { recursive: true });
    await cloneRepo({
      url: space.githubRepoUrl,
      token: space.githubToken,
      dest: cloneDir,
    });
  }

  // Fetch so detection always sees the latest commits on the default
  // branch — if the user just merged a Dockerfile change upstream, we
  // pick it up without forcing them to delete the clone.
  await fetchOrigin(cloneDir, space.githubToken);

  return generate({ repoPath: cloneDir });
}

// Convenience: read the current dockerfile content from a Space row.
// Returns null when the Space doesn't exist or is in host mode (no
// dockerfile saved).
export async function getDockerfileContent(spaceId: string): Promise<string | null> {
  const space = await findInternalActiveById(spaceId);
  return space?.dockerfileContent ?? null;
}

export type RuntimeModeView = {
  agentRuntimeMode: Space['agentRuntimeMode'];
  dockerfileContent: string | null;
};

export async function getRuntimeMode(spaceId: string): Promise<RuntimeModeView | null> {
  const space = await findInternalActiveById(spaceId);
  if (!space) return null;
  return {
    agentRuntimeMode: space.agentRuntimeMode,
    dockerfileContent: space.dockerfileContent,
  };
}
