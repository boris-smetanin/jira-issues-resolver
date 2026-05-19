import { Hono } from 'hono';
import { ZodError } from 'zod';
import { JiraCredentialError } from './integrations/jira/jira.client.js';
import { updateJiraCredentialDto } from './settings/dto/update-jira-credential.dto.js';
import { getJiraSettings, setJiraSettings } from './settings/settings.service.js';
import { createSpaceDto } from './spaces/dto/create-space.dto.js';
import {
  ValidationError,
  createSpace,
  findSpaceById,
  listSpaces,
} from './spaces/spaces.service.js';

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
      const first = err.issues[0];
      const path = first?.path.join('.') ?? '';
      const msg = first?.message ?? 'invalid input';
      return c.json({ field: path, error: msg }, 400);
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
      const first = err.issues[0];
      const path = first?.path.join('.') ?? '';
      const msg = first?.message ?? 'invalid input';
      return c.json({ error: path ? `${path}: ${msg}` : msg }, 400);
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
