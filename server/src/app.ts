import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { apiController } from './api.controller.js';

const WEB_DIST = resolve(import.meta.dirname, '../../web/dist');

export function createApp(): Hono {
  const app = new Hono();
  app.use('/api/*', cors());
  app.route('/api', apiController);
  app.get('/health', (c) => c.json({ ok: true }));

  if (process.env.NODE_ENV === 'production') {
    const indexHtml = readFileSync(`${WEB_DIST}/index.html`, 'utf8');
    app.use('/*', serveStatic({ root: WEB_DIST }));
    app.notFound((c) => {
      if (c.req.path.startsWith('/api/')) {
        return c.json({ error: 'not found' }, 404);
      }
      return c.html(indexHtml);
    });
  }

  return app;
}
