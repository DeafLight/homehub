// Cache des données distantes (météo, agendas) : rafraîchies au plus toutes les `maxAgeMs`, une seule requête à la
// fois par clé, et en cas de panne, la dernière valeur reste servie tant qu'elle n'est pas trop vieille.
import type { Logger } from '../config-store.ts';
import type { Clock } from './types.ts';

export type RefreshingCache<T> = {
  /**
   * Valeur pour `key`, rechargée si elle a plus de `maxAgeMs`. `label` nomme la donnée dans les logs : la clé peut
   * être une URL secrète et n'y apparaît jamais. Lève l'erreur du chargement s'il n'y a pas de valeur utilisable.
   */
  get(key: string, maxAgeMs: number, label: string): Promise<T>;
};

export type RefreshingCacheDeps<T> = {
  load(key: string): Promise<T>;
  clock: Clock;
  logger: Logger;
  /** Âge au-delà duquel une valeur n'est plus servie, même en cas de panne. */
  staleMaxMs: number;
  /** Délai minimal entre deux tentatives après un échec : évite de marteler une API en panne. */
  retryDelayMs?: number;
};

type Entry<T> = { value?: T; fetchedAt?: number; failedAt?: number; error?: unknown; inFlight?: Promise<T> };

export function createRefreshingCache<T>({
  load,
  clock,
  logger,
  staleMaxMs,
  retryDelayMs = 60_000,
}: RefreshingCacheDeps<T>): RefreshingCache<T> {
  const entries = new Map<string, Entry<T>>();

  return {
    async get(key, maxAgeMs, label) {
      let entry = entries.get(key);
      if (!entry) entries.set(key, (entry = {}));
      const now = clock().getTime();
      const age = entry.fetchedAt === undefined ? Infinity : now - entry.fetchedAt;
      const waitingRetry = entry.failedAt !== undefined && now - entry.failedAt < retryDelayMs;

      if (age > maxAgeMs && !waitingRetry) {
        const current = entry;
        try {
          current.inFlight ??= load(key).finally(() => {
            current.inFlight = undefined;
          });
          current.value = await current.inFlight;
          current.fetchedAt = now;
          current.failedAt = current.error = undefined;
          return current.value;
        } catch (err) {
          current.failedAt = now;
          current.error = err;
          const kept = age <= staleMaxMs ? ' ; données précédentes conservées' : '';
          logger.error(`${label} : ${(err as Error).message}${kept}.`);
        }
      }

      if (entry.value === undefined || age > staleMaxMs) throw entry.error ?? new Error(`${label} indisponible`);
      return entry.value;
    },
  };
}
