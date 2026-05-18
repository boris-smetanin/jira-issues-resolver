import { Hono } from 'hono';
import { listSpaces } from './spaces/spaces.service.js';

export const apiController = new Hono();

apiController.get('/spaces', async (c) => {
  const spaces = await listSpaces();
  return c.json(spaces);
});
