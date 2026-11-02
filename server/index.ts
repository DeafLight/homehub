import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const port = Number(process.env.PORT ?? 3000);

const app = new Hono();

app.get('/api/health', (c) => c.json({ status: 'ok', version, time: new Date().toISOString() }));

// Front compilé par Vite (npm run build) ; en dev, c'est Vite qui le sert.
app.use('/*', serveStatic({ root: './web/dist' }));
app.get('*', serveStatic({ path: './web/dist/index.html' }));

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`HomeHub ${version} à l'écoute sur le port ${info.port}`);
});

// Arrêt propre quand Docker envoie SIGTERM.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
