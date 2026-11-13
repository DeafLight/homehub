// Serveur HomeHub des captures : le vrai serveur, dans le monde fictif de fake-world.ts, avec deux faux appareils Cast
// (Google Home du salon, télé) qui téléchargent et « lisent » les messages vocaux des parents.
// Lancé par scripts/docs-captures.ts (qui fournit PORT, HOMEHUB_CONFIG, HOMEHUB_STATE_DIR, HOMEHUB_NAS_STATUS).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { startFakeCastDevice } from '../../server/services/cast-fake.ts';
import { installFakeClock, installFakeSources } from './fake-world.ts';

// DOCS_NOW (ms) : autre instant de départ (captures des vacances scolaires, en décembre).
installFakeClock(Number(process.env.DOCS_NOW) || undefined);
installFakeSources();

// Faux appareils Cast sur les ports qui suivent celui du serveur ; la configuration est réécrite en conséquence
// (copie dans le dossier d'état, l'originale ne bouge pas).
const port = Number(process.env.PORT) || 3190;
const source = process.env.HOMEHUB_CONFIG!;
const config = parse(readFileSync(source, 'utf8')) as { cast?: { mediaUrl?: string; devices: { id: string; port: number }[] } };
if (config.cast) {
  // Port des médias à part, comme sur le NAS (l'application derrière son proxy).
  process.env.HOMEHUB_MEDIA_PORT = String(port + 4);
  config.cast.mediaUrl = `http://127.0.0.1:${port + 4}`;
  for (const [i, device] of config.cast.devices.entries()) {
    device.port = port + 5 + i;
    const fake = await startFakeCastDevice({ port: device.port, fetchMedia: true });
    const log = () => void fake.nextPlay().then((p) => (console.log(`Faux appareil Cast ${device.id} : ${p.title}, ${p.bytes ?? 0} octets`), log()));
    log();
  }
  const copy = join(process.env.HOMEHUB_STATE_DIR!, 'homehub-docs.yaml');
  writeFileSync(copy, stringify(config));
  process.env.HOMEHUB_CONFIG = copy;
}
await import('../../server/index.ts');
