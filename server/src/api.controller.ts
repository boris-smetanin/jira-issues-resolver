import { Hono } from 'hono';
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
import { listAttemptsBySpace } from './resolve-attempts/resolve-attempts.service.js';
import { TickError, tickOnce } from './resolve-loop/resolve-loop.service.js';
import { updateJiraCredentialDto } from './settings/dto/update-jira-credential.dto.js';
import { getJiraSettings, setJiraSettings } from './settings/settings.service.js';
import { createSpaceDto } from './spaces/dto/create-space.dto.js';
import {
  ValidationError,
  assignAgentAccount,
  createSpace,
  findSpaceById,
  listSpaces,
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

apiController.get('/spaces/:id/resolve-attempts', async (c) => {
  const id = c.req.param('id');
  const space = await findSpaceById(id);
  if (!space) return c.json({ error: 'space not found' }, 404);
  return c.json(await listAttemptsBySpace(id));
});

apiController.post('/spaces/:id/loop/tick-now', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await tickOnce(id);
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
