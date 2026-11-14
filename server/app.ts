// Assemblage de l'application HTTP : chaque groupe de routes (dashboard, listes, stock, recettes, drive…) vit dans son fichier ; ici,
// les dépendances communes (droits, membres, PIN, reconnaissance faciale), le montage sous /api et le front compilé.
import { serveStatic } from '@hono/node-server/serve-static';
import type { Context, Hono } from 'hono';
import type { AddressMatch } from '../shared/types.ts';
import { type Access, createAccess, kioskKeyMatcher } from './access.ts';
import type { ConfigStore } from './config-store.ts';
import { createCameraApi } from './camera-api.ts';
import { createCastApi } from './cast-api.ts';
import { createDashboardApi } from './dashboard-api.ts';
import { createDevicesApi } from './devices-api.ts';
import { createDriveApi } from './drive-api.ts';
import { createFacesApi } from './faces-api.ts';
import { createFitnessApi } from './fitness-api.ts';
import { createHolidaysApi } from './holidays-api.ts';
import { createHousehold } from './household.ts';
import { createRouter, fail } from './http.ts';
import { createListsApi } from './lists-api.ts';
import { createMenuApi } from './menu-api.ts';
import { createCookApi } from './cook-api.ts';
import { createCookService } from './services/cook.ts';
import { createMenuService } from './services/menu.ts';
import type { MenuStore } from './sources/menus.ts';
import { createPinGate } from './pin-gate.ts';
import { createRecipeNotesApi } from './recipe-notes-api.ts';
import { createRecipesApi, createShareRoute } from './recipes-api.ts';
import { createShareInbox } from './services/recipe-imports.ts';
import { createRoutinesApi } from './routines-api.ts';
import { createSchoolLifeApi } from './school-life-api.ts';
import type { DashboardService } from './services/dashboard.ts';
import { createSchoolLifeService, type SchoolLifeService } from './services/school-life.ts';
import { createFaceRecognition } from './services/faces.ts';
import { createLiveCamera } from './services/live-camera.ts';
import { createScreenHub } from './services/screens.ts';
import { createTvNotifier } from './services/tv.ts';
import { createVoiceMessages, type VoiceMessages } from './services/voice-messages.ts';
import type { RecipeImporter } from './services/recipes.ts';
import type { NasService } from './services/nas.ts';
import type { DeviceStore } from './sources/devices.ts';
import type { ScreenAppStore } from './sources/screen-apps.ts';
import type { ScreenStore } from './sources/screens.ts';
import type { DriveReader } from './sources/drive-page.ts';
import type { DriveStore } from './sources/drive.ts';
import type { ActorSessions, FaceStore } from './sources/faces.ts';
import type { FitnessStore } from './sources/fitness.ts';
import type { GtfsSource } from './sources/gtfs.ts';
import type { HolidaySettingsStore } from './sources/holiday-settings.ts';
import type { ListsStore } from './sources/lists.ts';
import type { NotesStore } from './sources/notes.ts';
import type { ProductBase } from './sources/open-food-facts.ts';
import type { PinStore } from './sources/pins.ts';
import type { RecipeNoteStore } from './sources/recipe-notes.ts';
import type { RecipeStore } from './sources/recipes.ts';
import type { RoutinePlanStore } from './sources/routine-plans.ts';
import type { StockStore } from './sources/stock.ts';
import type { TimerStore } from './sources/timers.ts';
import type { TransitSettingsStore } from './sources/transit-settings.ts';
import type { Clock } from './sources/types.ts';
import { createStockApi } from './stock-api.ts';
import { createTimersApi } from './timers-api.ts';
import { createTransitApi } from './transit-api.ts';
import { createTvApi } from './tv-api.ts';
import { createScreenApi } from './screen-api.ts';

export type AppDeps = {
  config: ConfigStore;
  service: DashboardService;
  /** Vie scolaire des enfants (parents seulement) ; absente (tests) : aucun enfant n'en a. */
  schoolLife?: SchoolLifeService;
  nas: NasService;
  lists: ListsStore;
  notes: NotesStore;
  devices: DeviceStore;
  /** Télés appairées (appli HomeHub TV). */
  screens: ScreenStore;
  /** Applis du lanceur de chaque télé (tiroir de la télécommande). */
  screenApps: ScreenAppStore;
  pins: PinStore;
  faces: FaceStore;
  sessions: ActorSessions;
  timers: TimerStore;
  plans: RoutinePlanStore;
  stock: StockStore;
  fitness: FitnessStore;
  recipes: RecipeStore;
  /** Notes de la famille sur les recettes. */
  recipeNotes: RecipeNoteStore;
  menus: MenuStore;
  /** Drive : enseigne, magasin et produits retenus pour les articles de la liste. */
  drive: DriveStore;
  /** Lecture des fiches produit partagées ; absente (tests) : nom et contenance se saisissent. */
  driveReader?: DriveReader;
  /** Lecture des pages de recettes ; absente (tests) : l'import propose la saisie à la main. */
  recipeImporter?: RecipeImporter;
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
  /** Secret partagé avec le serveur TURN de la caméra en direct (HOMEHUB_TURN_SECRET) ; absent : pas de TURN. */
  turnSecret?: string;
  /** Messages vocaux vers les appareils Cast ; absent : le vrai client Cast (cast.devices de la config). */
  voice?: VoiceMessages;
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
    screens: deps.screens,
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

  // Caméra en direct : diffusions en mémoire, balayées régulièrement (téléphone ou tablette partis, durée écoulée).
  const camera = createLiveCamera({ clock, rules: () => config.current().camera, turnSecret: deps.turnSecret });
  setInterval(() => camera.sweep(), 5_000).unref();
  const voice = deps.voice ?? createVoiceMessages({ rules: () => config.current().cast, clock });

  const menu = createMenuService({ menus: deps.menus, recipes: deps.recipes, stock: deps.stock, lists: deps.lists, clock });
  const cook = createCookService({ menus: deps.menus, recipes: deps.recipes, stock: deps.stock, lists: deps.lists, menu, clock });

  const api = createRouter();
  // Le stock ou une recette a changé (scan, notre version modifiée, recette retirée) : la liste suit le menu. Les
  // notes sur une recette n'y changent rien ; « J'ai cuisiné » synchronise lui-même (services/cook.ts).
  api.use('*', async (c, next) => {
    await next();
    if (c.req.method === 'GET' || c.res.status >= 400 || !/^\/api\/(stock|recipes)(\/|$)/u.test(c.req.path) || /\/(notes|cook)(\/|$)/u.test(c.req.path)) return;
    await menu.sync({ ownerId: null, via: 'tablet' }).catch((err: unknown) => console.error('Synchronisation du menu :', err));
  });
  api.route('/', createDashboardApi({ ...deps, access }));
  api.route('/', createRoutinesApi({ plans: deps.plans, household, access }));
  api.route('/', createTransitApi({ ...deps, household, access }));
  api.route('/', createHolidaysApi({ holidaySettings: deps.holidaySettings, access }));
  api.route('/', createTimersApi({ timers: deps.timers, access, clock }));
  api.route('/', createListsApi({ ...deps, household, access, menu }));
  api.route('/', createMenuApi({ menus: deps.menus, service: menu, recipes: deps.recipes, access, clock }));
  api.route('/', createCookApi({ service: cook, access }));

  api.route('/', createDevicesApi({ household, devices: deps.devices, pins, access }));
  api.route('/', createCameraApi({ camera, household, access }));
  api.route('/', createTvApi({ tv: createTvNotifier({ rules: () => config.current().tv }), household, access }));
  api.route('/', createCastApi({ voice, config, household, access }));
  api.route('/', createScreenApi({ screens: deps.screens, apps: deps.screenApps, hub: createScreenHub({ clock }), voice, config, household, access }));
  api.route('/', createFacesApi({ household, faces: deps.faces, recognition, sessions, pins, access }));
  api.route('/', createFitnessApi({ fitness: deps.fitness, household, access }));
  const schoolLife = deps.schoolLife ?? createSchoolLifeService({ household, school: { coursesFor: async () => null }, logger: console });
  api.route('/', createSchoolLifeApi({ schoolLife, access }));
  const shareInbox = createShareInbox();
  api.route('/', createRecipesApi({ recipes: deps.recipes, notes: deps.recipeNotes, importer: deps.recipeImporter, access, clock, inbox: shareInbox }));
  api.route('/', createRecipeNotesApi({ recipes: deps.recipes, notes: deps.recipeNotes, access }));
  api.route('/', createDriveApi({ drive: deps.drive, reader: deps.driveReader, stock: deps.stock, menus: deps.menus, lists: deps.lists, access, clock }));
  api.route('/', createStockApi({ stock: deps.stock, productBase: deps.productBase, lists: deps.lists, access, clock }));

  const app = createRouter();
  app.route('/api', api);
  // Avant le front : une route d'API inconnue ne doit pas renvoyer index.html.
  app.all('/api/*', () => fail(404, 'Route inconnue'));
  // « Partager » vers l'appli (share_target en POST) : avant le front, qui ne sert que des GET.
  app.route('/', createShareRoute(shareInbox));

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
