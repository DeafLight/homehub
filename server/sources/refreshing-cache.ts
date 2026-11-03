// Cache des données distantes (météo, agendas, emplois du temps) : rafraîchies au plus toutes les `maxAgeMs`, une
// seule requête à la fois par clé. Une valeur encore utilisable est servie tout de suite et rafraîchie en
// arrière-plan : un service lent ou muet ne ralentit jamais l'affichage. En cas de panne, la dernière valeur reste
// servie tant qu'elle n'est pas trop vieille.
import type { Logger } from '../config-store.ts';
import type { SourceStatus } from './source-status.ts';
import type { Clock } from './types.ts';

export type RefreshingCache<T> = {
  /**
   * Valeur pour `key`. Si elle a plus de `maxAgeMs`, elle est rechargée : en arrière-plan si l'ancienne est encore
   * utilisable (elle est renvoyée sans attendre), sinon en attendant le résultat. `label` nomme la donnée dans les
   * logs : la clé peut être une URL secrète et n'y apparaît jamais. Lève l'erreur du chargement s'il n'y a pas de
   * valeur utilisable.
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
  /** Reçoit le résultat de chaque chargement, sous le nom `label`. */
  status?: SourceStatus;
};

type Entry<T> = { value?: T; fetchedAt?: number; failedAt?: number; error?: unknown; inFlight?: Promise<void> };

export function createRefreshingCache<T>({
  load,
  clock,
  logger,
  staleMaxMs,
  retryDelayMs = 60_000,
  status,
}: RefreshingCacheDeps<T>): RefreshingCache<T> {
  const entries = new Map<string, Entry<T>>();
  const ageOf = (entry: Entry<T>, now: number) => (entry.fetchedAt === undefined ? Infinity : now - entry.fetchedAt);
  const usable = (entry: Entry<T>, now: number) => entry.value !== undefined && ageOf(entry, now) <= staleMaxMs;

  /** Lance le rechargement (ou rejoint celui en cours) ; ne rejette jamais : le résultat est noté dans l'entrée. */
  function refresh(entry: Entry<T>, key: string, startedAt: number, label: string): Promise<void> {
    entry.inFlight ??= load(key)
      .then(
        (value) => {
          entry.value = value;
          entry.fetchedAt = startedAt;
          entry.failedAt = entry.error = undefined;
          status?.record(label);
        },
        (err) => {
          entry.failedAt = startedAt;
          entry.error = err;
          status?.record(label, err);
          const kept = usable(entry, clock().getTime()) ? ' ; données précédentes conservées' : '';
          logger.error(`${label} : ${(err as Error).message}${kept}.`);
        },
      )
      .finally(() => {
        entry.inFlight = undefined;
      });
    return entry.inFlight;
  }

  return {
    async get(key, maxAgeMs, label) {
      let entry = entries.get(key);
      if (!entry) entries.set(key, (entry = {}));
      const now = clock().getTime();
      const waitingRetry = entry.failedAt !== undefined && now - entry.failedAt < retryDelayMs;

      if (ageOf(entry, now) > maxAgeMs && !waitingRetry) {
        const pending = refresh(entry, key, now, label);
        if (!usable(entry, now)) await pending;
      }

      if (!usable(entry, clock().getTime())) throw entry.error ?? new Error(`${label} indisponible`);
      return entry.value as T;
    },
  };
}
