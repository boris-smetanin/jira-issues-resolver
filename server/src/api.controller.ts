import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z, ZodError } from 'zod';
import {
  createAgentAccountDto,
  updateAgentAccountDto,
} from './agent-accounts/dto/create-agent-account.dto.js';
import {
  AccountValidationError,
  createAccount,
  deleteAccount,
  findAccountById,
  listAccounts,
  updateAccount,
} from './agent-accounts/agent-accounts.service.js';
import { listProviders } from './integrations/agent-providers/registry.js';
import { JiraCredentialError } from './integrations/jira/jira.client.js';
import { readHistoricalAttemptLog, streamLogs } from './logs/logs.service.js';
import {
  findAttemptWithChain,
  listAttemptsGroupedByIssue,
} from './resolve-attempts/resolve-attempts.service.js';
import {
  TickError,
  setLoopInterval,
  startLoop,
  stopLoop,
  tickNow,
} from './resolve-loop/resolve-loop.service.js';
import { updateJiraCredentialDto } from './settings/dto/update-jira-credential.dto.js';
import { updateIssueTypeMapDto } from './settings/dto/update-issue-type-map.dto.js';
import {
  getIssueTypeMap,
  getJiraSettings,
  setIssueTypeMap,
  setJiraSettings,
} from './settings/settings.service.js';
import {
  detectDockerfileForSpace,
  SpaceNotFoundError,
} from './orchestrator/dockerfile.service.js';
import { createSpaceDto } from './spaces/dto/create-space.dto.js';
import { updateSpaceDto } from './spaces/dto/update-space.dto.js';
import {
  saveDockerfileAndEnableContainerMode,
  setRuntimeModeToHost,
} from './spaces/spaces.repository.js';
import {
  ValidationError,
  assignAgentAccount,
  createSpace,
  findSpaceById,
  listSpaces,
  updateSpace,
} from './spaces/spaces.service.js';

function zodErrorResponse(err: ZodError): { field: string; error: string } {
  const first = err.issues[0];
  return {
    field: first?.path.join('.') ?? '',
    error: first?.message ?? 'invalid input',
  };
}

export const apiController = new Hono();

apiController.get('/spaces', async (c) => {
  return c.json(await listSpaces());
});

apiController.get('/spaces/:id', async (c) => {
  const space = await findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'space not found' }, 404);
  return c.json(space);
});

apiController.post('/spaces', async (c) => {
  const raw = await c.req.json().catch(() => null);
  let input;
  try {
    input = createSpaceDto.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json(zodErrorResponse(err), 400);
    }
    throw err;
  }

  try {
    const space = await createSpace(input);
    return c.json(space, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ field: err.field, error: err.message }, 400);
    }
    throw err;
  }
});

// Slice 10: returns attempts grouped by Jira issue. Each bucket carries the
// full attempt chain for that issue (latest first), and buckets are ordered
// by their latest attempt's started_at desc.
apiController.put('/spaces/:id', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  let input;
  try {
    input = updateSpaceDto.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json(zodErrorResponse(err), 400);
    }
    throw err;
  }
  try {
    const space = await updateSpace(id, input);
    return c.json(space);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ field: err.field, error: err.message }, 400);
    }
    if (err instanceof JiraCredentialError) {
      return c.json({ error: `Jira: ${err.message}` }, 400);
    }
    throw err;
  }
});

// Slice 10: returns attempts grouped by Jira issue, paginated. Each
// bucket carries the full attempt chain for that issue (latest first);
// buckets are ordered by their latest attempt's started_at desc. Optional
// `?search=` filters issue keys by case-insensitive substring.
apiController.get('/spaces/:id/resolve-attempts', async (c) => {
  const id = c.req.param('id');
  const space = await findSpaceById(id);
  if (!space) return c.json({ error: 'space not found' }, 404);

  // `page` / `pageSize` are coerced + clamped here so the service layer
  // doesn't have to defend against weird query strings.
  const rawPage = Number.parseInt(c.req.query('page') ?? '0', 10);
  const rawPageSize = Number.parseInt(c.req.query('pageSize') ?? '20', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
  const pageSize = Number.isFinite(rawPageSize) ? Math.max(1, Math.min(100, rawPageSize)) : 20;
  const search = (c.req.query('search') ?? '').slice(0, 200);

  return c.json(
    await listAttemptsGroupedByIssue(id, {
      page,
      pageSize,
      ...(search ? { search } : {}),
    }),
  );
});

// Slice 10: per-attempt detail. Returns the attempt + its prior chain +
// next attempt (for navigation on the detail page).
apiController.get('/resolve-attempts/:id', async (c) => {
  const id = c.req.param('id');
  const result = await findAttemptWithChain(id);
  if (!result) return c.json({ error: 'attempt not found' }, 404);
  return c.json(result);
});

apiController.get('/spaces/:id/logs/stream', (c) => {
  const id = c.req.param('id');
  return streamSSE(c, async (stream) => {
    await streamLogs(id, stream);
  });
});

apiController.get('/spaces/:id/resolve-attempts/:rid/logs', async (c) => {
  const spaceId = c.req.param('id');
  const rid = c.req.param('rid');
  const text = await readHistoricalAttemptLog(spaceId, rid);
  if (text === undefined) return c.json({ error: 'attempt not found' }, 404);
  return c.text(text);
});

apiController.post('/spaces/:id/loop/tick-now', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await tickNow(id);
    return c.json(result);
  } catch (err) {
    if (err instanceof TickError) {
      return c.json({ error: err.message }, err.status as 400 | 404);
    }
    if (err instanceof JiraCredentialError) {
      return c.json({ error: `Jira: ${err.message}` }, 400);
    }
    throw err;
  }
});

apiController.post('/spaces/:id/loop/start', async (c) => {
  const id = c.req.param('id');
  try {
    const space = await startLoop(id);
    return c.json(space);
  } catch (err) {
    if (err instanceof TickError) {
      return c.json({ error: err.message }, err.status as 400 | 404);
    }
    throw err;
  }
});

apiController.post('/spaces/:id/loop/stop', async (c) => {
  const id = c.req.param('id');
  try {
    const space = await stopLoop(id);
    return c.json(space);
  } catch (err) {
    if (err instanceof TickError) {
      return c.json({ error: err.message }, err.status as 400 | 404);
    }
    throw err;
  }
});

apiController.patch('/spaces/:id/loop/interval', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  const body = z
    .object({ tickIntervalSeconds: z.number().int().min(30).max(3600) })
    .safeParse(raw);
  if (!body.success) {
    return c.json(zodErrorResponse(body.error), 400);
  }
  try {
    const space = await setLoopInterval(id, body.data.tickIntervalSeconds);
    return c.json(space);
  } catch (err) {
    if (err instanceof TickError) {
      return c.json({ error: err.message }, err.status as 400 | 404);
    }
    throw err;
  }
});

apiController.patch('/spaces/:id/account', async (c) => {
  const spaceId = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  const body = z
    .object({ agentAccountId: z.string().uuid(), agentModel: z.string().trim().min(1) })
    .safeParse(raw);
  if (!body.success) {
    return c.json(zodErrorResponse(body.error), 400);
  }
  try {
    const space = await assignAgentAccount(
      spaceId,
      body.data.agentAccountId,
      body.data.agentModel,
    );
    return c.json(space);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ field: err.field, error: err.message }, 400);
    }
    throw err;
  }
});

// Slice 11: container-runtime endpoints. Three routes:
//   POST  /spaces/:id/dockerfile/detect — ensure clone + run the
//         generator; return { content, detectedFrom, warnings }. Does
//         NOT save — the UI shows it in an editor first.
//   PATCH /spaces/:id/dockerfile         — save edited content +
//         flip agent_runtime_mode to 'container' (atomic).
//   PATCH /spaces/:id/runtime-mode       — flip to host (clears
//         dockerfile_content). Switching to container requires
//         providing a Dockerfile, so that direction goes via PATCH
//         /dockerfile above.
apiController.post('/spaces/:id/dockerfile/detect', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await detectDockerfileForSpace(id);
    return c.json(result);
  } catch (err) {
    if (err instanceof SpaceNotFoundError) {
      return c.json({ error: 'space not found' }, 404);
    }
    throw err;
  }
});

apiController.patch('/spaces/:id/dockerfile', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  const body = z
    .object({ dockerfileContent: z.string().min(1, 'dockerfileContent must not be empty') })
    .safeParse(raw);
  if (!body.success) return c.json(zodErrorResponse(body.error), 400);
  const space = await saveDockerfileAndEnableContainerMode(id, body.data.dockerfileContent);
  if (!space) return c.json({ error: 'space not found' }, 404);
  return c.json(space);
});

apiController.patch('/spaces/:id/runtime-mode', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  const body = z.object({ agentRuntimeMode: z.enum(['host', 'container']) }).safeParse(raw);
  if (!body.success) return c.json(zodErrorResponse(body.error), 400);
  if (body.data.agentRuntimeMode === 'container') {
    return c.json(
      {
        field: 'agentRuntimeMode',
        error:
          'Switching to container mode requires a Dockerfile — use PATCH /spaces/:id/dockerfile instead.',
      },
      400,
    );
  }
  const space = await setRuntimeModeToHost(id);
  if (!space) return c.json({ error: 'space not found' }, 404);
  return c.json(space);
});

apiController.get('/agent-providers', (c) => {
  return c.json(listProviders());
});

apiController.get('/agent-accounts', async (c) => {
  return c.json(await listAccounts());
});

apiController.get('/agent-accounts/:id', async (c) => {
  const account = await findAccountById(c.req.param('id'));
  if (!account) return c.json({ error: 'account not found' }, 404);
  return c.json(account);
});

apiController.post('/agent-accounts', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = createAgentAccountDto.safeParse(raw);
  if (!parsed.success) {
    return c.json(zodErrorResponse(parsed.error), 400);
  }
  try {
    const account = await createAccount({
      provider: parsed.data.provider as 'claude' | 'codex',
      name: parsed.data.name,
      apiKey: parsed.data.apiKey,
    });
    return c.json(account, 201);
  } catch (err) {
    if (err instanceof AccountValidationError) {
      return c.json({ field: err.field, error: err.message }, err.status as 400 | 404 | 409);
    }
    throw err;
  }
});

apiController.put('/agent-accounts/:id', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  const parsed = updateAgentAccountDto.safeParse(raw);
  if (!parsed.success) {
    return c.json(zodErrorResponse(parsed.error), 400);
  }
  try {
    const account = await updateAccount(id, parsed.data);
    return c.json(account);
  } catch (err) {
    if (err instanceof AccountValidationError) {
      return c.json({ field: err.field, error: err.message }, err.status as 400 | 404 | 409);
    }
    throw err;
  }
});

apiController.delete('/agent-accounts/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await deleteAccount(id);
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof AccountValidationError) {
      return c.json({ field: err.field, error: err.message }, err.status as 400 | 404 | 409);
    }
    throw err;
  }
});

apiController.get('/settings/jira', async (c) => {
  return c.json(await getJiraSettings());
});

apiController.put('/settings/jira', async (c) => {
  const raw = await c.req.json().catch(() => null);
  let input;
  try {
    input = updateJiraCredentialDto.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json(zodErrorResponse(err), 400);
    }
    throw err;
  }

  try {
    const result = await setJiraSettings(input);
    return c.json(result);
  } catch (err) {
    if (err instanceof JiraCredentialError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
});

// Slice 16a: issue-type → prompt-shape map. The lists drive BOTH the JQL
// filter (so the Resolve Loop only fetches recognised types) AND the
// prompt-shape dispatcher in the orchestrator.
apiController.get('/settings/issue-type-map', async (c) => {
  return c.json(await getIssueTypeMap());
});

apiController.put('/settings/issue-type-map', async (c) => {
  const raw = await c.req.json().catch(() => null);
  let input;
  try {
    input = updateIssueTypeMapDto.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json(zodErrorResponse(err), 400);
    }
    throw err;
  }
  return c.json(await setIssueTypeMap(input));
});
