// Assemblage de l'application HTTP : chaque groupe de routes (dashboard, listes, stock…) vit dans son fichier ; ici,
// les dépendances communes (droits, membres, PIN, reconnaissance faciale), le montage sous /api et le front compilé.
import { serveStatic } from '@hono/node-server/serve-static';
import type { Context, Hono } from 'hono';
import type { AddressMatch } from '../shared/types.ts';
import { type Access, createAccess, kioskKeyMatcher } from './access.ts';
import type { ConfigStore } from './config-store.ts';
import { createDashboardApi } from './dashboard-api.ts';
import { createDevicesApi } from './devices-api.ts';
import { createFacesApi } from './faces-api.ts';
import { createFitnessApi } from './fitness-api.ts';
import { createHolidaysApi } from './holidays-api.ts';
import { createHousehold } from './household.ts';
import { createRouter, fail } from './http.ts';
import { createListsApi } from './lists-api.ts';
import { createPinGate } from './pin-gate.ts';
import { createRoutinesApi } from './routines-api.ts';
import type { DashboardService } from './services/dashboard.ts';
import { createFaceRecognition } from './services/faces.ts';
import type { NasService } from './services/nas.ts';
import type { DeviceStore } from './sources/devices.ts';
import type { ActorSessions, FaceStore } from './sources/faces.ts';
import type { FitnessStore } from './sources/fitness.ts';
import type { GtfsSource } from './sources/gtfs.ts';
import type { HolidaySettingsStore } from './sources/holiday-settings.ts';
import type { ListsStore } from './sources/lists.ts';
import type { NotesStore } from './sources/notes.ts';
import type { ProductBase } from './sources/open-food-facts.ts';
import type { PinStore } from './sources/pins.ts';
import type { RoutinePlanStore } from './sources/routine-plans.ts';
import type { StockStore } from './sources/stock.ts';
import type { TimerStore } from './sources/timers.ts';
import type { TransitSettingsStore } from './sources/transit-settings.ts';
import type { Clock } from './sources/types.ts';
import { createStockApi } from './stock-api.ts';
import { createTimersApi } from './timers-api.ts';
import { createTransitApi } from './transit-api.ts';

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
  /** Page « Vacances scolaires » ; absent (tests) : page indisponible. */
  holidaySettings?: HolidaySettingsStore;
  searchAddress?: (query: string, near?: { lat: number; lon: number }) => Promise<AddressMatch[]>;
  /** Clé de la tablette (HOMEHUB_KIOSK_KEY) ; absente : tablette reconnue à son adresse seulement. */
  kioskKey?: string;
  clock: Clock;
  version: string;
  /** Dossier du front compilé ; absent en test et en dev (Vite sert le front). */
  staticRoot?: string;
};

const hasExtension = (path: string) => /\.[^/]+$/.test(path);

export function createApp(deps: AppDeps): Hono {
  const { config, sessions, kioskKey, clock, staticRoot } = deps;
  const household = createHousehold(config);
  const access: Access = createAccess({
    config,
    devices: deps.devices,
    isKey: kioskKeyMatcher(kioskKey),
    actorOf: (token) => sessions.get(token, config.current().faces.sessionMinutes),
  });
  const pins = createPinGate(deps.pins);
  const recognition = createFaceRecognition({
    faces: deps.faces,
    sessions,
    household,
    rules: () => config.current().faces,
    clock,
  });

  const api = createRouter();
  api.route('/', createDashboardApi({ ...deps, access }));
  api.route('/', createRoutinesApi({ plans: deps.plans, household, access }));
  api.route('/', createTransitApi({ ...deps, household, access }));
  api.route('/', createHolidaysApi({ holidaySettings: deps.holidaySettings, access }));
  api.route('/', createTimersApi({ timers: deps.timers, access, clock }));
  api.route('/', createListsApi({ ...deps, household, access }));
  api.route('/', createDevicesApi({ household, devices: deps.devices, pins, access }));
  api.route('/', createFacesApi({ household, faces: deps.faces, recognition, sessions, pins, access }));
  api.route('/', createFitnessApi({ fitness: deps.fitness, household, access }));
  api.route('/', createStockApi({ stock: deps.stock, productBase: deps.productBase, lists: deps.lists, access, clock }));

  const app = createRouter();
  app.route('/api', api);
  // Avant le front : une route d'API inconnue ne doit pas renvoyer index.html.
  app.all('/api/*', () => fail(404, 'Route inconnue'));

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
