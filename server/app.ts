// Assemblage de l'application HTTP : chaque groupe de routes (dashboard, listes, stock, recettes, drive…) vit dans son fichier ; ici,
// les dépendances communes (droits, membres, PIN, reconnaissance faciale), le montage sous /api et le front compilé.
import { serveStatic } from '@hono/node-server/serve-static';
import type { Context, Hono } from 'hono';
import type { AddressMatch, Note } from '../shared/types.ts';
import { type Access, createAccess, kioskKeyMatcher } from './access.ts';
import type { ConfigStore } from './config-store.ts';
import { createCameraApi } from './camera-api.ts';
import { createCastApi } from './cast-api.ts';
import { createDashboardApi } from './dashboard-api.ts';
import { createDevicesApi } from './devices-api.ts';
import { createDriveApi } from './drive-api.ts';
import { createFacesApi } from './faces-api.ts';
import { createFitnessApi } from './fitness-api.ts';
import { createFitnessScreenApi } from './fitness-screen-api.ts';
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
import { BUS_TICK_MS, createScreenBusAlerts } from './services/screen-bus.ts';
import { createScreenHub, type ScreenHub } from './services/screens.ts';
import { createScreenReplies } from './services/screen-replies.ts';
import { createScreenWorkouts } from './services/screen-workouts.ts';
import { createScreenTalk } from './services/screen-talk.ts';
import { createVoiceMessages, type VoiceMessages } from './services/voice-messages.ts';
import type { RecipeImporter } from './services/recipes.ts';
import type { NasService } from './services/nas.ts';
import type { DeviceStore } from './sources/devices.ts';
import type { ScreenAppStore } from './sources/screen-apps.ts';
import { createScreenFilm } from './services/screen-film.ts';
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
import { createScreenAlertsApi } from './screen-alerts-api.ts';
import { createTimerAlerts } from './services/timer-alerts.ts';
import { createScreenAlertStore, type ScreenAlertStore } from './sources/screen-alerts.ts';
import { createScreenRemindersApi } from './screen-reminders-api.ts';
import { createScreenReminders, reminderBuilders } from './services/screen-reminders.ts';
import type { ScreenReminderStore } from './sources/screen-reminders.ts';
import { createBedtimeApi } from './bedtime-api.ts';
import { createBedtime } from './services/bedtime.ts';
import type { BedtimeStore } from './sources/bedtime.ts';
import { createScreenMediaApi } from './screen-media-api.ts';
import { createEcranApi } from './ecran-api.ts';
import { createEcranService } from './services/ecran.ts';
import { createScreenShareApi, shareMediaHandler } from './screen-share-api.ts';
import { createSharedMedia } from './services/shared-media.ts';
import { SCREEN_MEDIA_MAX_BYTES } from '../shared/screen-media.ts';
import { createScreenCookApi } from './screen-cook-api.ts';
import { createScreenCooking } from './services/screen-cook.ts';
import { createScreenTalkApi } from './screen-talk-api.ts';
import type { MotisSource } from './sources/motis.ts';
import type { VehiclePositionSource } from './sources/vehicle-positions.ts';
import type { TomTomSource } from './sources/tomtom.ts';
import type { PushRecord, PushStore } from './sources/push.ts';
import { type PushMessage, type PushResult, sendPush } from './services/web-push.ts';
import { createNextTripService } from './services/next-trip.ts';
import { createTripPush } from './services/trip-push.ts';
import { createNotePush } from './services/note-push.ts';
import { createTimerPush } from './services/timer-push.ts';
import { createTaskPush } from './services/task-push.ts';
import { createTripApi } from './trip-api.ts';
import { createMapApi } from './map-api.ts';
import { createPushApi } from './push-api.ts';

/** Contact VAPID (exigé par les services de push) : la page publique du projet, aucune adresse personnelle. */
const PUSH_SUBJECT = 'https://github.com/DeafLight/homehub';

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
  /** Alertes de la maison sur les télés ; absent (tests) : en mémoire, toutes actives. */
  screenAlerts?: ScreenAlertStore;
  /** Événements des télés, partagés avec les alertes du serveur (pluie) ; absent (tests) : propre à l'application. */
  screenHub?: ScreenHub;
  /** Réglages des rappels sur la télé ; absent (tests) : ni rappels, ni leurs routes. */
  screenReminders?: ScreenReminderStore;
  /** Heure du coucher des enfants sur les télés ; absent (tests) : ni coucher, ni ses routes. */
  bedtime?: BedtimeStore;
  /** Appareil de secours de chaque télé éteinte (Google Home) ; absent : pas de secours. */
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
  /** Lieu sûr d'un rendez-vous d'agenda (« Prochain trajet ») ; absent : seuls les lieux de la famille comptent. */
  locateAddress?: (query: string, near: { lat: number; lon: number }) => Promise<AddressMatch | null>;
  /** Itinéraires par MOTIS (« Prochain trajet ») ; absent ou non configuré : pas de carte. */
  motis?: MotisSource;
  /** Durée en voiture avec le trafic (ligne voiture des parents) ; absent : MOTIS sans trafic. */
  tomtom?: TomTomSource;
  /** Positions réelles des véhicules (carte en route) ; absent : positions estimées seulement. */
  vehicles?: VehiclePositionSource;
  /** Notifications Web Push (« Pars dans 5 min », « Nouveaux mots », « Minuteurs », « Tâches en retard ») ; absent (tests) : ni notifications, ni leurs routes. */
  push?: PushStore;
  /** Envoi d'une notification ; absent : Web Push réel (services/web-push.ts). */
  sendPush?: (subscription: PushRecord, message: PushMessage) => Promise<PushResult>;
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
  /** Fichier PMTiles du fond de la carte en route ; absent : tracé sur un fond uni. */
  mapTiles?: string;
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
  // Prochain trajet du téléphone (carte de l'accueil) et notification « Pars dans 5 min ».
  const transitNow = () => deps.transitSettings?.current();
  const nextTrip = createNextTripService({
    appointments: deps.service.appointments,
    owners: household.ownerIds,
    places: () => transitNow()?.places ?? [],
    commuteOf: (ownerId) => transitNow()?.commutes[ownerId],
    isParent: (ownerId) => Boolean(household.member(ownerId)?.parent),
    center: () => {
      const weather = config.current().weather;
      return weather && { lat: weather.latitude, lon: weather.longitude };
    },
    locate: deps.locateAddress,
    motis: deps.motis,
    tomtom: deps.tomtom,
    clock,
    logger: console,
  });
  api.route('/', createTripApi({ nextTrip, access, vehicles: deps.vehicles, clock }));
  api.route('/', createMapApi({ tilesPath: () => deps.mapTiles, access }));
  /** Mot enregistré : notification « Nouveau mot » aux téléphones du destinataire (sans notifications : rien). */
  let onNote: ((note: Note) => void) | undefined;
  if (deps.push) {
    const store = deps.push;
    const send = deps.sendPush ?? ((sub: PushRecord, message: PushMessage) => sendPush(sub, message, { keys: store.keys(), subject: PUSH_SUBJECT, now: clock() }));
    api.route('/', createPushApi({ store, access, send }));
    onNote = createNotePush({ store, devices: () => deps.devices.list(), nameOf: household.nameOf, send, logger: console }).announce;
    createTripPush({
      store,
      devices: () => deps.devices.list(),
      commuteOf: deps.service.commute,
      hasCommute: (ownerId) => transitNow()?.commutes[ownerId] !== undefined,
      nextTrip,
      send,
      clock,
      logger: console,
    }).start();
    const pushDeps = { store, devices: () => deps.devices.list(), members: household.members, send, clock, logger: console };
    createTimerPush({ ...pushDeps, timers: deps.timers }).start();
    createTaskPush({ ...pushDeps, lists: deps.lists }).start();
  }
  api.route('/', createHolidaysApi({ holidaySettings: deps.holidaySettings, access }));
  api.route('/', createTimersApi({ timers: deps.timers, access, clock }));
  api.route('/', createListsApi({ ...deps, household, access, menu, onNote }));
  api.route('/', createMenuApi({ menus: deps.menus, service: menu, recipes: deps.recipes, access, clock }));
  api.route('/', createCookApi({ service: cook, access }));

  api.route('/', createDevicesApi({ household, devices: deps.devices, pins, access }));
  api.route('/', createCameraApi({ camera, household, access }));
  // Télés appairées (appli HomeHub TV) : leurs événements servent au direct, à la télécommande, aux messages écrits et aux alertes.
  const screenHub = deps.screenHub ?? createScreenHub({ clock });
  // Réponses rapides des télés sous un message écrit (fonction 10).
  const screenReplies = createScreenReplies({ clock });
  api.route('/', createTvApi({ screens: deps.screens, hub: screenHub, config, household, access, replies: screenReplies }));
  api.route('/', createCastApi({ voice, config, household, access }));
  // Mode film (fonction 15) : bandeaux discrets ; automatique selon le panneau Télés.
  const screenAlerts = deps.screenAlerts ?? createScreenAlertStore();
  const film = createScreenFilm({ hub: screenHub, clock });
  void screenAlerts.get().then((a) => film.setAuto(a.film)).catch((err: unknown) => console.error('Réglage du mode film :', err));
  film.start();
  screenHub.useDiscreet(film.discreet);
  api.route('/', createScreenApi({ screens: deps.screens, apps: deps.screenApps, hub: screenHub, config, household, access, film }));
  // Minuteur terminé : alerte sur les télés allumées (fonction 3), réglable dans le panneau Télés.
  api.route('/', createScreenAlertsApi({ alerts: screenAlerts, timers: deps.timers, access, clock, onChange: (a) => film.setAuto(a.film) }));
  createTimerAlerts({ timers: deps.timers, screens: deps.screens, hub: screenHub, alerts: screenAlerts, clock }).start();
  // Alerte du bus du matin sur la télé (réglage par trajet, page Transports).
  const busAlerts = createScreenBusAlerts({
    members: () => household.members().map((m) => ({ id: m.id, name: m.name })),
    alertOf: deps.service.busAlert,
    screens: async () => (await deps.screens.list()).map((s) => s.id),
    hub: screenHub,
    clock,
    logger: console,
  });
  setInterval(() => void busAlerts.tick().catch((err: unknown) => console.error('Alerte du bus sur la télé :', err)), BUS_TICK_MS).unref();
  if (deps.screenReminders) {
    // Rappels sur la télé (routine du soir, mots à lire) : vérifiés toutes les 30 s, poussés aux télés allumées.
    const reminders = createScreenReminders({
      store: deps.screenReminders,
      hub: screenHub,
      screenIds: async () => (await deps.screens.list()).map((s) => s.id),
      builders: reminderBuilders({ household, routineOf: (id) => deps.service.routine(id), notes: deps.notes }),
      clock,
    });
    reminders.start();
    api.route('/', createScreenRemindersApi({ store: deps.screenReminders, reminders, access, clock }));
  }
  if (deps.bedtime) {
    // Heure du coucher des enfants (fonction 16) : rappel, pause puis écran de veille sur les télés allumées.
    const bedtime = createBedtime({
      store: deps.bedtime,
      hub: screenHub,
      screenIds: async () => (await deps.screens.list()).map((s) => s.id),
      holidays: async () => (await deps.service.holidays()).holidays,
      children: () => household.members().filter((m) => !m.parent).map((m) => m.name),
      nameOf: (id) => household.member(id)?.name ?? null,
      clock,
    });
    bedtime.start();
    api.route('/', createBedtimeApi({ bedtime, access }));
  }
  api.route('/', createScreenMediaApi({ screens: deps.screens, hub: screenHub, household, access, pins, film }));
  api.route('/', createEcranApi({ ecran: createEcranService({ service: deps.service, menus: deps.menus, recipes: deps.recipes, household, clock }), access }));
  // Photo ou vidéo partagée vers la télé (fonction 11) : reçue par /partager, envoyée depuis la page du téléphone.
  const sharedMedia = createSharedMedia({ clock });
  api.route('/', createScreenShareApi({ screens: deps.screens, hub: screenHub, store: sharedMedia, household, access }));
  // Mode cuisine d'une recette sur la télé (fonction 13).
  api.route('/', createScreenCookApi({ screens: deps.screens, hub: screenHub, cooking: createScreenCooking(), recipes: deps.recipes, timers: deps.timers, access, clock }));
  // Parler en direct à la télé (fonction 9) : la voix du téléphone relayée par HomeHub.
  api.route('/', createScreenTalkApi({ screens: deps.screens, talk: createScreenTalk({ clock, hub: screenHub, rules: () => config.current().camera }), household, access }));
  api.route('/', createFacesApi({ household, faces: deps.faces, recognition, sessions, pins, access }));
  api.route('/', createFitnessApi({ fitness: deps.fitness, household, access }));
  const screenWorkouts = createScreenWorkouts({ clock, hub: screenHub });
  api.route('/', createFitnessScreenApi({ fitness: deps.fitness, screens: deps.screens, hub: screenHub, workouts: screenWorkouts, household, access }));
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
  app.route('/', createShareRoute(shareInbox, { maxBytes: SCREEN_MEDIA_MAX_BYTES, handle: shareMediaHandler(sharedMedia) }));

  if (staticRoot) {
    // index.html jamais mis en cache : après un déploiement, le rechargement doit récupérer la nouvelle version.
    // Les assets ont un hash dans leur nom, ils peuvent rester en cache. L'en-tête est posé AVANT serveStatic :
    // son onFound est appelé une fois la réponse construite, trop tard pour une requête GET.
    app.use('*', async (c: Context, next) => {
      if (!hasExtension(c.req.path) || c.req.path.endsWith('.html') || c.req.path === '/sw.js') c.header('Cache-Control', 'no-cache');
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
