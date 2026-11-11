// Point d'entrée : lit l'environnement, assemble les dépendances et démarre le serveur.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { FAMILY_ID } from '../shared/types.ts';
import { KIOSK_KEY_MIN_LENGTH } from './access.ts';
import { createApp } from './app.ts';
import { calendarsOf, hasCalendars, loadConfig } from './config.ts';
import { createConfigStore, watchConfigFile } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createDashboardService } from './services/dashboard.ts';
import { createNasService } from './services/nas.ts';
import { createSchoolLifeService } from './services/school-life.ts';
import { type Credentials, createEcoleDirecteClient, createEcoleDirecteSource } from './sources/ecoledirecte.ts';
import { createIcalAgendaSource } from './sources/ical.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createFitnessStore } from './sources/fitness.ts';
import { createActorSessions, createFaceStore } from './sources/faces.ts';
import { createRoutinePlanStore } from './sources/routine-plans.ts';
import { createRoutineStore } from './sources/routines.ts';
import { createTimerStore } from './sources/timers.ts';
import { createListsStore, listsTaskSource } from './sources/lists.ts';
import { createNasStatusSource } from './sources/nas-status.ts';
import { createNotesStore } from './sources/notes.ts';
import { createOpenFoodFactsClient } from './sources/open-food-facts.ts';
import { createStockStore } from './sources/stock.ts';
import { createOpenMeteoWeatherSource } from './sources/open-meteo.ts';
import { createPinStore } from './sources/pins.ts';
import { createFileStateStore, createPawnoteClient, createPronoteSource } from './sources/pronote.ts';
import { createSampleAgenda } from './sources/sample.ts';
import { createHolidaySettingsStore } from './sources/holiday-settings.ts';
import { createSchoolHolidaysSource } from './sources/school-holidays.ts';
import { createSourceStatus } from './sources/source-status.ts';
import { searchAddress } from './sources/geocode.ts';
import { createGtfsSource } from './sources/gtfs.ts';
import { createIrigoClient, createTransitSource } from './sources/irigo.ts';
import { createTransitSettingsStore } from './sources/transit-settings.ts';
import { type Clock, type Sources, firstSchoolSource } from './sources/types.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const port = Number(process.env.PORT ?? 3000);
const configPath = process.env.HOMEHUB_CONFIG ?? 'config/homehub.yaml';
const staticRoot = process.env.HOMEHUB_STATIC_ROOT ?? './web/dist';
/** Dossier inscriptible pour ce que HomeHub doit retenir (jeton Pronote, listes, téléphones appairés). */
const stateDir = process.env.HOMEHUB_STATE_DIR ?? 'state';
/** Relevé du NAS écrit par la tâche cron nas-status.sh (nas-config), à côté de la configuration. */
const nasStatusPath = process.env.HOMEHUB_NAS_STATUS ?? join(dirname(configPath), 'nas-status.json');
mkdirSync(stateDir, { recursive: true });
/** Clé de la tablette, donnée une fois dans son adresse de démarrage (/#key=…) ; secret, dans app.env. */
const kioskKey = process.env.HOMEHUB_KIOSK_KEY?.trim() || undefined;
if (kioskKey && kioskKey.length < KIOSK_KEY_MIN_LENGTH) {
  throw new Error(`HOMEHUB_KIOSK_KEY trop courte : au moins ${KIOSK_KEY_MIN_LENGTH} caractères (ex. openssl rand -base64 24)`);
}

// Au démarrage, une configuration invalide est fatale ; ensuite, elle est rechargée à chaud (voir config-store.ts).
let initialConfig;
try {
  initialConfig = await loadConfig(configPath);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const config = createConfigStore(initialConfig);
const stopWatching = watchConfigFile(configPath, config, console);

const clock: Clock = () => new Date();
const startedAt = clock();
const sourceStatus = createSourceStatus(clock);
/** Compte ÉcoleDirecte (app.env) : identifiants du compte Famille et jetons de confiance de l'appareil. */
function ecoleDirecteCredentials(env: NodeJS.ProcessEnv): Credentials | undefined {
  const { ECOLEDIRECTE_IDENTIFIANT: identifiant, ECOLEDIRECTE_MOTDEPASSE: motdepasse } = env;
  const { ECOLEDIRECTE_CN: cn, ECOLEDIRECTE_CV: cv } = env;
  if (!identifiant || !motdepasse) return undefined;
  return { identifiant, motdepasse, ...(cn && cv && { trust: { cn, cv } }) };
}

const household = createHousehold(config);

const sampleAgenda = createSampleAgenda(() => household.members().map((m) => m.id), FAMILY_ID, clock);
const ical = createIcalAgendaSource({
  calendarsFor: (ownerId) => calendarsOf(config.current(), ownerId),
  refreshMinutes: () => config.current().agenda.refreshMinutes,
  secret: (name) => process.env[name],
  clock,
  logger: console,
  status: sourceStatus,
});
const lists = createListsStore({ path: join(stateDir, 'lists.json'), clock });
const devices = createDeviceStore({ path: join(stateDir, 'devices.json'), clock });
const pins = createPinStore({ path: join(stateDir, 'pins.json'), clock });
const notes = createNotesStore({ path: join(stateDir, 'notes.json'), clock });
const faces = createFaceStore({ path: join(stateDir, 'faces.json') });
const sessions = createActorSessions(clock);
const routines = createRoutineStore({ path: join(stateDir, 'routines.json'), clock });
const plans = createRoutinePlanStore({ path: join(stateDir, 'routine-plans.json'), clock, config });
await plans.load();
const timers = createTimerStore({ clock, path: join(stateDir, 'timers.json') });
const stock = createStockStore({ path: join(stateDir, 'stock.json'), clock });
const fitness = createFitnessStore({ path: join(stateDir, 'fitness.json'), clock });
await fitness.load();
// Open Food Facts demande un User-Agent qui dit qui appelle : le nom et l'adresse du projet, rien de la famille.
const productBase = createOpenFoodFactsClient({ userAgent: `HomeHub/${version} (https://github.com/DeafLight/homehub)` });
const sources: Sources = {
  tasks: listsTaskSource(lists, FAMILY_ID),
  notes,
  // Agenda d'exemple tant qu'aucun agenda n'est configuré (développement, première installation).
  agenda: { eventsFor: (...args) => (hasCalendars(config.current()) ? ical : sampleAgenda).eventsFor(...args) },
  weather: createOpenMeteoWeatherSource({
    location: () => config.current().weather,
    clock,
    logger: console,
    status: sourceStatus,
  }),
  school: firstSchoolSource(
    createEcoleDirecteSource({
      studentFor: (ownerId) => household.member(ownerId)?.ecoledirecte,
      refreshMinutes: () => config.current().ecoledirecte.refreshMinutes,
      credentials: () => ecoleDirecteCredentials(process.env),
      client: createEcoleDirecteClient(),
      clock,
      logger: console,
      status: sourceStatus,
    }),
    createPronoteSource({
      childFor: (ownerId) => household.member(ownerId)?.pronote,
      refreshMinutes: () => config.current().pronote.refreshMinutes,
      store: createFileStateStore(join(stateDir, 'pronote.json')),
      client: createPawnoteClient(),
      clock,
      logger: console,
      status: sourceStatus,
    }),
  ),
};
const transit = createTransitSource({
  client: createIrigoClient(),
  refreshSeconds: () => config.current().transit.refreshSeconds,
  clock,
  logger: console,
  status: sourceStatus,
});
const transitSettings = createTransitSettingsStore({ path: join(stateDir, 'transit-settings.json'), clock, config });
await transitSettings.load();
const gtfs = createGtfsSource({ path: join(stateDir, 'irigo-gtfs.zip'), clock, logger: console, status: sourceStatus });
// Lu en arrière-plan dès le démarrage : la page « Transports » et le trajet du matin en ont besoin.
void gtfs.index();
// Réglage de la page « Vacances scolaires », sinon section `holidays` du YAML.
const holidaySettings = createHolidaySettingsStore({ path: join(stateDir, 'holiday-settings.json'), clock, config });
await holidaySettings.load();
const holidays = createSchoolHolidaysSource({
  settings: holidaySettings.settings,
  path: join(stateDir, 'school-holidays.json'),
  clock,
  logger: console,
  status: sourceStatus,
});
const service = createDashboardService({ config, sources, clock, logger: console, routines, plans, transit, transitSettings, gtfs, holidays });
const nas = createNasService({
  nasStatus: createNasStatusSource({ path: nasStatusPath, logger: console }),
  sourceStatus,
  version,
  startedAt,
});
const schoolLife = createSchoolLifeService({ household, school: sources.school, logger: console });
const app = createApp({ config, service, schoolLife, nas, lists, notes, devices, pins, faces, sessions, timers, plans, stock, fitness, productBase, transitSettings, gtfs, holidaySettings, searchAddress, kioskKey, clock, version, staticRoot });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `HomeHub ${version} à l'écoute sur le port ${info.port} (${initialConfig.members.length} membres, ${configPath}, clé de tablette : ${kioskKey ? 'oui' : 'non'}, proxys de confiance : ${initialConfig.trustedProxies.join(', ') || 'aucun'})`,
  );
});

// Arrêt propre quand Docker envoie SIGTERM.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopWatching();
    server.close(() => process.exit(0));
  });
}
