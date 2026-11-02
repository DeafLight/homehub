// Configuration courante, rechargée à chaud quand le fichier YAML change.
import { createHash } from 'node:crypto';
import { type Stats, unwatchFile, watchFile } from 'node:fs';
import { type AppConfig, loadConfig } from './config.ts';

/** Ce dont le service a besoin : lire la configuration courante. */
export type ConfigProvider = {
  current(): AppConfig;
};

export type ConfigStore = ConfigProvider & {
  /** Empreinte de la configuration courante. */
  revision(): string;
  /** Remplace la configuration ; renvoie true si elle a réellement changé. */
  set(config: AppConfig): boolean;
};

export type Logger = Pick<Console, 'log' | 'error'>;

export const configRevision = (config: AppConfig) =>
  createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12);

export function createConfigStore(initial: AppConfig): ConfigStore {
  let config = initial;
  let revision = configRevision(initial);
  return {
    current: () => config,
    revision: () => revision,
    set(next) {
      const nextRevision = configRevision(next);
      if (nextRevision === revision) return false;
      config = next;
      revision = nextRevision;
      return true;
    },
  };
}

/**
 * Relit le fichier. S'il est invalide, la configuration précédente est conservée (l'erreur est journalisée) :
 * une faute de frappe ne doit pas faire tomber l'écran de la tablette.
 */
export async function reloadConfig(path: string, store: ConfigStore, logger: Logger): Promise<boolean> {
  try {
    const next = await loadConfig(path);
    const changed = store.set(next);
    if (changed) logger.log(`Configuration rechargée : ${next.members.length} membres (révision ${store.revision()})`);
    return changed;
  } catch (err) {
    logger.error(`${(err as Error).message}\nConfiguration précédente conservée.`);
    return false;
  }
}

/**
 * Surveille le fichier par scrutation (fs.watchFile) plutôt que par inotify : fiable à travers un montage Docker
 * et quel que soit l'éditeur (écriture sur place ou remplacement du fichier). Renvoie la fonction d'arrêt.
 */
export function watchConfigFile(path: string, store: ConfigStore, logger: Logger, intervalMs = 2000): () => void {
  const onChange = (current: Stats, previous: Stats) => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
      void reloadConfig(path, store, logger);
    }
  };
  watchFile(path, { interval: intervalMs }, onChange);
  return () => unwatchFile(path, onChange);
}
