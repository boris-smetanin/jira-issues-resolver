import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { apiController } from './api.controller.js';

export function createApp(): Hono {
  const app = new Hono();
  app.use('/api/*', cors());
  app.route('/api', apiController);
  app.get('/health', (c) => c.json({ ok: true }));
  return app;
}
