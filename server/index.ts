// Point d'entrée : lit l'environnement, assemble les dépendances et démarre le serveur.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { FAMILY_ID } from '../shared/types.ts';
import { createApp } from './app.ts';
import { calendarsOf, hasCalendars, loadConfig } from './config.ts';
import { createConfigStore, watchConfigFile } from './config-store.ts';
import { createDashboardService } from './services/dashboard.ts';
import { createNasService } from './services/nas.ts';
import { type Credentials, createEcoleDirecteClient, createEcoleDirecteSource } from './sources/ecoledirecte.ts';
import { createIcalAgendaSource } from './sources/ical.ts';
import { createNasStatusSource } from './sources/nas-status.ts';
import { createOpenMeteoWeatherSource } from './sources/open-meteo.ts';
import { createFileStateStore, createPawnoteClient, createPronoteSource } from './sources/pronote.ts';
import { createSampleSources } from './sources/sample.ts';
import { createSourceStatus } from './sources/source-status.ts';
import { type Clock, type Sources, firstSchoolSource } from './sources/types.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const port = Number(process.env.PORT ?? 3000);
const configPath = process.env.HOMEHUB_CONFIG ?? 'config/homehub.yaml';
const staticRoot = process.env.HOMEHUB_STATIC_ROOT ?? './web/dist';
/** Dossier inscriptible pour ce que HomeHub doit retenir (jeton Pronote). */
const stateDir = process.env.HOMEHUB_STATE_DIR ?? 'state';
/** Relevé du NAS écrit par la tâche cron nas-status.sh (nas-config), à côté de la configuration. */
const nasStatusPath = process.env.HOMEHUB_NAS_STATUS ?? join(dirname(configPath), 'nas-status.json');

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

const memberOf = (ownerId: string) => config.current().members.find((m) => m.id === ownerId);

const sample = createSampleSources(() => config.current().members.map((m) => m.id), FAMILY_ID, clock);
const ical = createIcalAgendaSource({
  calendarsFor: (ownerId) => calendarsOf(config.current(), ownerId),
  refreshMinutes: () => config.current().agenda.refreshMinutes,
  secret: (name) => process.env[name],
  clock,
  logger: console,
  status: sourceStatus,
});
const sources: Sources = {
  ...sample,
  // Agenda d'exemple tant qu'aucun agenda n'est configuré (développement, première installation).
  agenda: { eventsFor: (...args) => (hasCalendars(config.current()) ? ical : sample.agenda).eventsFor(...args) },
  weather: createOpenMeteoWeatherSource({
    location: () => config.current().weather,
    clock,
    logger: console,
    status: sourceStatus,
  }),
  school: firstSchoolSource(
    createEcoleDirecteSource({
      studentFor: (ownerId) => memberOf(ownerId)?.ecoledirecte,
      refreshMinutes: () => config.current().ecoledirecte.refreshMinutes,
      credentials: () => ecoleDirecteCredentials(process.env),
      client: createEcoleDirecteClient(),
      clock,
      logger: console,
      status: sourceStatus,
    }),
    createPronoteSource({
      childFor: (ownerId) => memberOf(ownerId)?.pronote,
      refreshMinutes: () => config.current().pronote.refreshMinutes,
      store: createFileStateStore(join(stateDir, 'pronote.json')),
      client: createPawnoteClient(),
      clock,
      logger: console,
      status: sourceStatus,
    }),
  ),
};
const service = createDashboardService({ config, sources, clock, logger: console });
const nas = createNasService({
  nasStatus: createNasStatusSource({ path: nasStatusPath, logger: console }),
  sourceStatus,
  version,
  startedAt,
});
const app = createApp({ config, service, nas, clock, version, staticRoot });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `HomeHub ${version} à l'écoute sur le port ${info.port} (${initialConfig.members.length} membres, ${configPath})`,
  );
});

// Arrêt propre quand Docker envoie SIGTERM.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopWatching();
    server.close(() => process.exit(0));
  });
}
