import { Hono } from 'hono';
import { ZodError } from 'zod';
import { updateJiraCredentialDto } from './settings/dto/update-jira-credential.dto.js';
import { getJiraSettings, setJiraSettings } from './settings/settings.service.js';
import { JiraCredentialError } from './integrations/jira/jira.client.js';
import { listSpaces } from './spaces/spaces.service.js';

export const apiController = new Hono();

apiController.get('/spaces', async (c) => {
  const spaces = await listSpaces();
  return c.json(spaces);
});

apiController.get('/settings/jira', async (c) => {
  const settings = await getJiraSettings();
  return c.json(settings);
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
