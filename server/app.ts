// Couche HTTP : routes fines qui valident l'entrée, délèguent au service et sérialisent la réponse.
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { type AddressMatch, FAMILY_ID, type Health, WEEKS_AHEAD } from '../shared/types.ts';
import { type Access, createAccess, kioskKeyMatcher } from './access.ts';
import { toPublicConfig } from './config.ts';
import type { ConfigStore } from './config-store.ts';
import { createFitnessApi } from './fitness-api.ts';
import { createListsApi } from './lists-api.ts';
import { createStockApi } from './stock-api.ts';
import type { DashboardService } from './services/dashboard.ts';
import type { NasService } from './services/nas.ts';
import type { DeviceStore } from './sources/devices.ts';
import type { FitnessStore } from './sources/fitness.ts';
import type { ActorSessions, FaceStore } from './sources/faces.ts';
import type { PinStore } from './sources/pins.ts';
import { type RoutinePlanStore, routineSettingsInput } from './sources/routine-plans.ts';
import type { ListsStore } from './sources/lists.ts';
import type { NotesStore } from './sources/notes.ts';
import type { ProductBase } from './sources/open-food-facts.ts';
import type { StockStore } from './sources/stock.ts';
import { MAX_TIMERS, TIMER_LABEL_MAX, TIMER_MAX_SECONDS, type TimerStore } from './sources/timers.ts';
import type { GtfsSource } from './sources/gtfs.ts';
import { type TransitSettingsStore, transitSettingsInput } from './sources/transit-settings.ts';
import type { Clock } from './sources/types.ts';

export type AppDeps = {
  config: ConfigStore;
  service: DashboardService;
  nas: NasService;
  lists: ListsStore;
  notes: NotesStore;
  devices: DeviceStore;
  pins: PinStore;
  faces: FaceStore;
  sessions: ActorSessions;
  timers: TimerStore;
  plans: RoutinePlanStore;
  stock: StockStore;
  fitness: FitnessStore;
  /** Base de produits (Open Food Facts…) ; absente (tests) : tout code inconnu se saisit à la main. */
  productBase?: ProductBase;
  /** Page « Transports » ; absents (tests) : page indisponible. */
  transitSettings?: TransitSettingsStore;
  gtfs?: GtfsSource;
  searchAddress?: (query: string, near?: { lat: number; lon: number }) => Promise<AddressMatch[]>;
  /** Clé de la tablette (HOMEHUB_KIOSK_KEY) ; absente : tablette reconnue à son adresse seulement. */
  kioskKey?: string;
  clock: Clock;
  version: string;
  /** Dossier du front compilé ; absent en test et en dev (Vite sert le front). */
  staticRoot?: string;
};

const taskUpdateSchema = z.object({ done: z.boolean() });
const timerSchema = z.object({
  label: z.string().trim().max(TIMER_LABEL_MAX).default(''),
  seconds: z.number().int().min(10).max(TIMER_MAX_SECONDS),
});
const weekOffsetSchema = z.coerce.number().int().min(0).max(WEEKS_AHEAD);
const latLonSchema = z
  .string()
  .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/u)
  .transform((v) => {
    const [lat, lon] = v.split(',').map(Number);
    return { lat, lon };
  });

const hasExtension = (path: string) => /\.[^/]+$/.test(path);

export function createApp(deps: AppDeps): Hono {
  const { config, service, nas, devices, sessions, timers, plans, transitSettings, gtfs, searchAddress, kioskKey, clock, version, staticRoot } = deps;
  const access: Access = createAccess({
    config,
    devices,
    isKey: kioskKeyMatcher(kioskKey),
    actorOf: (token) => sessions.get(token, config.current().faces.sessionMinutes),
  });
  const app = new Hono();
  const api = new Hono();

  api.get('/health', (c) =>
    c.json<Health>({ status: 'ok', version, configRevision: config.revision(), time: clock().toISOString() }),
  );

  api.get('/config', (c) => c.json(toPublicConfig(config.current(), config.revision())));

  api.get('/home', async (c) => c.json(await service.home()));

  api.get('/weather', async (c) => c.json({ forecast: await service.weatherForecast() }));

  api.get('/week', async (c) => {
    const offset = weekOffsetSchema.safeParse(c.req.query('offset') ?? 0);
    if (!offset.success) return c.json({ error: `offset attendu : entier de 0 à ${WEEKS_AHEAD}` }, 400);
    return c.json(await service.week(offset.data));
  });

  api.get('/nas', async (c) => c.json(await nas.data()));

  api.get('/dashboard/:ownerId', async (c) => {
    const data = await service.dashboard(c.req.param('ownerId'));
    return data ? c.json(data) : c.json({ error: 'Profil inconnu' }, 404);
  });

  api.put('/dashboard/:ownerId/tasks/:taskId', async (c) => {
    const body = taskUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Corps attendu : { "done": true|false }' }, 400);
    const who = await access.write(c, c.req.param('ownerId'));
    if (!('author' in who)) return c.json({ error: who.error, identify: who.identify }, who.status);
    const task = await service.setTaskDone(c.req.param('ownerId'), c.req.param('taskId'), body.data.done, who.author);
    return task ? c.json(task) : c.json({ error: 'Tâche inconnue' }, 404);
  });

  /** Routine du moment seule (appli du téléphone, sans le reste du dashboard). */
  api.get('/dashboard/:ownerId/routine', async (c) => {
    const ownerId = c.req.param('ownerId');
    if (!service.hasOwner(ownerId)) return c.json({ error: 'Profil inconnu' }, 404);
    return c.json({ routine: await service.routine(ownerId) });
  });

  /** Prochains passages Irigo aux arrêts suivis (accueil, veille). */
  api.get('/transit', async (c) => c.json(await service.transit()));

  /** Devoirs seuls (appli du téléphone), en lecture : on les coche dans Pronote ou ÉcoleDirecte. */
  api.get('/dashboard/:ownerId/homework', async (c) => {
    const ownerId = c.req.param('ownerId');
    if (!service.hasOwner(ownerId)) return c.json({ error: 'Profil inconnu' }, 404);
    return c.json({ homework: await service.homework(ownerId) });
  });

  /** Routine du jour : mêmes droits que les tâches du profil. */
  api.put('/dashboard/:ownerId/routine/:itemId', async (c) => {
    const body = taskUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Corps attendu : { "done": true|false }' }, 400);
    const who = await access.write(c, c.req.param('ownerId'));
    if (!('author' in who)) return c.json({ error: who.error, identify: who.identify }, who.status);
    const item = await service.setRoutineDone(c.req.param('ownerId'), c.req.param('itemId'), body.data.done, who.author);
    return item ? c.json(item) : c.json({ error: 'Étape inconnue' }, 404);
  });

  /** Réglages des routines (page « Routines ») : lus par tous, modifiés par un parent seulement. */
  api.get('/routines', (c) => c.json(plans.current()));

  api.put('/routines', async (c) => {
    const body = routineSettingsInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      const issue = body.error.issues[0];
      return c.json({ error: `Réglages refusés : ${issue?.message ?? 'format inattendu'}` }, 400);
    }
    const who = await access.write(c, null);
    if (!('author' in who)) return c.json({ error: who.error, identify: who.identify }, who.status);
    const { members } = config.current();
    if (!members.find((m) => m.id === who.author.ownerId)?.parent) {
      return c.json({ error: 'Seul un parent peut modifier les routines' }, 403);
    }
    const unknown = Object.keys(body.data.members).find((id) => id === FAMILY_ID || !members.some((m) => m.id === id));
    if (unknown) return c.json({ error: `Profil inconnu : ${unknown}` }, 400);
    return c.json(await plans.save(body.data, who.author));
  });

  // Page « Transports » : réservée à la tablette et aux téléphones appairés (les adresses de la famille y sont).
  const trusted = async (c: Context) => {
    const caller = await access.caller(c);
    return caller.kiosk || caller.device !== null;
  };
  const gtfsIndex = async () => (gtfs ? await gtfs.index() : null);

  api.get('/transit/settings', async (c) => {
    if (!transitSettings) return c.json({ error: 'Réglages des transports indisponibles' }, 404);
    if (!(await trusted(c))) return c.json({ error: 'Réservé à la tablette' }, 403);
    return c.json(transitSettings.current());
  });

  api.put('/transit/settings', async (c) => {
    if (!transitSettings) return c.json({ error: 'Réglages des transports indisponibles' }, 404);
    const body = transitSettingsInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      const issue = body.error.issues[0];
      return c.json({ error: `Réglages refusés : ${issue?.message ?? 'format inattendu'}` }, 400);
    }
    const who = await access.write(c, null);
    if (!('author' in who)) return c.json({ error: who.error, identify: who.identify }, who.status);
    const { members } = config.current();
    if (!members.find((m) => m.id === who.author.ownerId)?.parent) {
      return c.json({ error: 'Seul un parent peut modifier les transports' }, 403);
    }
    const unknown = Object.keys(body.data.commutes).find((id) => !members.some((m) => m.id === id));
    if (unknown) return c.json({ error: `Profil inconnu : ${unknown}` }, 400);
    return c.json(await transitSettings.save(body.data, who.author));
  });

  /** Adresses correspondant à la saisie (Géoplateforme), autour du lieu de la météo s'il est réglé. */
  api.get('/transit/addresses', async (c) => {
    const query = (c.req.query('q') ?? '').trim();
    if (!searchAddress) return c.json({ error: 'Recherche d’adresse indisponible' }, 404);
    if (!(await trusted(c))) return c.json({ error: 'Réservé à la tablette' }, 403);
    if (query.length < 3 || query.length > 200) return c.json({ addresses: [] });
    const weather = config.current().weather;
    try {
      return c.json({ addresses: await searchAddress(query, weather && { lat: weather.latitude, lon: weather.longitude }) });
    } catch (err) {
      console.error(`Recherche d'adresse : ${(err as Error).message}`);
      return c.json({ error: 'Recherche d’adresse indisponible' }, 503);
    }
  });

  /** Arrêts : par nom (`q`) ou près d'un point (`near=lat,lon`). */
  api.get('/transit/stops', async (c) => {
    if (!(await trusted(c))) return c.json({ error: 'Réservé à la tablette' }, 403);
    const index = await gtfsIndex();
    if (!index) return c.json({ error: 'Horaires Irigo indisponibles' }, 503);
    const near = c.req.query('near');
    if (near !== undefined) {
      const point = latLonSchema.safeParse(near);
      if (!point.success) return c.json({ error: 'near attendu : lat,lon' }, 400);
      return c.json({ stops: index.nearby(point.data) });
    }
    return c.json({ stops: index.search(c.req.query('q') ?? '') });
  });

  /** Lignes directes entre deux points (`from=lat,lon&to=lat,lon`). */
  api.get('/transit/routes', async (c) => {
    if (!(await trusted(c))) return c.json({ error: 'Réservé à la tablette' }, 403);
    const from = latLonSchema.safeParse(c.req.query('from'));
    const to = latLonSchema.safeParse(c.req.query('to'));
    if (!from.success || !to.success) return c.json({ error: 'from et to attendus : lat,lon' }, 400);
    const index = await gtfsIndex();
    if (!index) return c.json({ error: 'Horaires Irigo indisponibles' }, 503);
    return c.json({ routes: index.routes(from.data, to.data) });
  });

  // Minuteurs : à personne en particulier ; il faut seulement être reconnu (tablette) ou un téléphone appairé.
  api.get('/timers', (c) => c.json(timers.list()));

  api.post('/timers', async (c) => {
    const body = timerSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: `Durée attendue : de 10 s à ${TIMER_MAX_SECONDS / 3600} h` }, 400);
    const who = await access.write(c, null);
    if (!('author' in who)) return c.json({ error: who.error, identify: who.identify }, who.status);
    const timer = timers.start(body.data.label, body.data.seconds, who.author);
    return timer ? c.json(timer, 201) : c.json({ error: `${MAX_TIMERS} minuteurs au plus` }, 409);
  });

  /** Arrêter un minuteur qui sonne : n'importe qui à la tablette (ou un téléphone) ; en cours : quelqu'un de reconnu. */
  api.delete('/timers/:id', async (c) => {
    const timer = timers.list().find((t) => t.id === c.req.param('id'));
    if (!timer) return c.json({ error: 'Minuteur inconnu' }, 404);
    if (new Date(timer.endsAt) <= clock()) {
      const caller = await access.caller(c);
      if (!caller.kiosk && !caller.device) return c.json({ error: 'Lecture seule : appareil non appairé' }, 403);
    } else {
      const who = await access.write(c, null);
      if (!('author' in who)) return c.json({ error: who.error, identify: who.identify }, who.status);
    }
    timers.stop(timer.id);
    return c.body(null, 204);
  });

  api.route('/', createListsApi({ ...deps, access }));
  api.route('/', createFitnessApi({ fitness: deps.fitness, config, access }));
  api.route('/', createStockApi({ stock: deps.stock, productBase: deps.productBase, lists: deps.lists, access, clock }));

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
