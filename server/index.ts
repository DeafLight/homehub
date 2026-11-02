// Point d'entrée : lit l'environnement, assemble les dépendances et démarre le serveur.
import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { FAMILY_ID } from '../shared/types.ts';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createConfigStore, watchConfigFile } from './config-store.ts';
import { createDashboardService } from './services/dashboard.ts';
import { createOpenMeteoWeatherSource } from './sources/open-meteo.ts';
import { createSampleSources } from './sources/sample.ts';
import type { Clock, Sources } from './sources/types.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const port = Number(process.env.PORT ?? 3000);
const configPath = process.env.HOMEHUB_CONFIG ?? 'config/homehub.yaml';
const staticRoot = process.env.HOMEHUB_STATIC_ROOT ?? './web/dist';

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
const sources: Sources = {
  ...createSampleSources(() => config.current().members.map((m) => m.id), FAMILY_ID, clock),
  weather: createOpenMeteoWeatherSource({ location: () => config.current().weather, clock, logger: console }),
};
const service = createDashboardService({ config, sources, clock, logger: console });
const app = createApp({ config, service, clock, version, staticRoot });

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
