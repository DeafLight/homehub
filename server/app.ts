// Couche HTTP : routes fines qui valident l'entrée, délèguent au service et sérialisent la réponse.
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { Health } from '../shared/types.ts';
import { toPublicConfig } from './config.ts';
import type { ConfigStore } from './config-store.ts';
import type { DashboardService } from './services/dashboard.ts';
import type { Clock } from './sources/types.ts';

export type AppDeps = {
  config: ConfigStore;
  service: DashboardService;
  clock: Clock;
  version: string;
  /** Dossier du front compilé ; absent en test et en dev (Vite sert le front). */
  staticRoot?: string;
};

const taskUpdateSchema = z.object({ done: z.boolean() });

const hasExtension = (path: string) => /\.[^/]+$/.test(path);

export function createApp({ config, service, clock, version, staticRoot }: AppDeps): Hono {
  const app = new Hono();
  const api = new Hono();

  api.get('/health', (c) =>
    c.json<Health>({ status: 'ok', version, configRevision: config.revision(), time: clock().toISOString() }),
  );

  api.get('/config', (c) => c.json(toPublicConfig(config.current(), config.revision())));

  api.get('/home', async (c) => c.json(await service.home()));

  api.get('/weather', async (c) => c.json({ forecast: await service.weatherForecast() }));

  api.get('/dashboard/:ownerId', async (c) => {
    const data = await service.dashboard(c.req.param('ownerId'));
    return data ? c.json(data) : c.json({ error: 'Profil inconnu' }, 404);
  });

  api.put('/dashboard/:ownerId/tasks/:taskId', async (c) => {
    const body = taskUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Corps attendu : { "done": true|false }' }, 400);
    const task = await service.setTaskDone(c.req.param('ownerId'), c.req.param('taskId'), body.data.done);
    return task ? c.json(task) : c.json({ error: 'Tâche inconnue' }, 404);
  });

  app.route('/api', api);
  // Avant le front : une route d'API inconnue ne doit pas renvoyer index.html.
  app.all('/api/*', (c) => c.json({ error: 'Route inconnue' }, 404));

  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path} :`, err);
    return c.json({ error: 'Erreur interne' }, 500);
  });

  if (staticRoot) {
    // index.html jamais mis en cache : après un déploiement, le rechargement doit récupérer la nouvelle version.
    // Les assets ont un hash dans leur nom, ils peuvent rester en cache. L'en-tête est posé AVANT serveStatic :
    // son onFound est appelé une fois la réponse construite, trop tard pour une requête GET.
    app.use('*', async (c: Context, next) => {
      if (!hasExtension(c.req.path) || c.req.path.endsWith('.html')) c.header('Cache-Control', 'no-cache');
      await next();
    });
    app.use('/*', serveStatic({ root: staticRoot }));
    // Fichier absent (ex. /favicon.ico) : 404, pas la page HTML.
    app.get('*', async (c, next) => (hasExtension(c.req.path) ? c.notFound() : next()));
    // Routage côté front (/p/<id>...) : toute autre URL renvoie l'application.
    app.get('*', serveStatic({ path: `${staticRoot}/index.html` }));
  }

  return app;
}
