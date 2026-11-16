// Durée en voiture avec le trafic actuel (ou habituel à l'heure d'arrivée, pour un rendez-vous lointain), pour la
// ligne voiture des parents (« Prochain trajet ») : API TomTom Routing (calculateRoute, traffic=true).
// Clé dans l'environnement (HOMEHUB_TOMTOM_KEY) ; sans clé, la source est désactivée et l'appelant prend la durée
// sans trafic de MOTIS. TomTom est un tiers : il ne reçoit que l'origine arrondie à environ
// 100 m (`roughly`, fait par l'appelant) et la destination, jamais la position exacte du téléphone. Réponses gardées
// 5 min en mémoire (la clé gratuite a un quota) ; ni l'adresse appelée (clé, positions) ni les positions ne sont
// journalisées.
import { z } from 'zod';
import type { LatLon } from '../../shared/trip.ts';
import type { Logger } from '../config-store.ts';
import type { SourceStatus } from './source-status.ts';
import type { Clock } from './types.ts';

export const TOMTOM_URL = 'https://api.tomtom.com';
/** Nom de la source sur la page « Le NAS ». */
export const TOMTOM_STATUS = 'TomTom (trafic)';
const TIMEOUT_MS = 8_000;
const CACHE_MS = 5 * 60_000;
const MAX_CACHED = 32;

const responseSchema = z.object({
  routes: z
    .array(z.object({ summary: z.object({ lengthInMeters: z.number(), travelTimeInSeconds: z.number(), trafficDelayInSeconds: z.number().default(0) }) }))
    .min(1),
});

export type CarRoute = { seconds: number; meters: number; trafficDelaySeconds: number };

export type TomTomSource = {
  enabled(): boolean;
  /**
   * Durée et distance avec le trafic actuel ou, avec `arriveAt` (rendez-vous lointain), le trafic habituel pour
   * arriver à cette heure ; lève une erreur si TomTom ne répond pas ou n'est pas configuré.
   */
  route(from: LatLon, to: LatLon, arriveAt?: Date): Promise<CarRoute>;
};

const point = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
/** Heure d'arrivée au format de TomTom (RFC 3339, sans millisecondes). */
const rfc3339 = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/u, 'Z');

export function createTomTomSource({
  key,
  clock,
  logger,
  status,
  baseUrl = TOMTOM_URL,
  fetchFn = (...a) => fetch(...a),
}: {
  /** Clé de l'API ; relue à chaque appel. undefined : désactivé. */
  key: () => string | undefined;
  clock: Clock;
  logger: Logger;
  status?: SourceStatus;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}): TomTomSource {
  const cache = new Map<string, { at: number; result: Promise<CarRoute> }>();

  async function request(apiKey: string, from: LatLon, to: LatLon, arriveAt?: Date): Promise<CarRoute> {
    const params = new URLSearchParams({ key: apiKey, traffic: 'true', travelMode: 'car', routeType: 'fastest', ...(arriveAt && { arriveAt: rfc3339(arriveAt) }) });
    try {
      const res = await fetchFn(`${baseUrl}/routing/1/calculateRoute/${point(from)}:${point(to)}/json?${params}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { summary } = responseSchema.parse(await res.json()).routes[0];
      status?.record(TOMTOM_STATUS);
      return { seconds: summary.travelTimeInSeconds, meters: summary.lengthInMeters, trafficDelaySeconds: summary.trafficDelayInSeconds };
    } catch (err) {
      // Jamais l'adresse appelée dans le message : elle contient la clé et des positions.
      const message = err instanceof z.ZodError ? 'réponse illisible' : (err as Error).message;
      logger.error(`TomTom indisponible : ${message}`);
      status?.record(TOMTOM_STATUS, new Error(message));
      throw new Error(message);
    }
  }

  return {
    enabled: () => Boolean(key()),
    route(from, to, arriveAt) {
      const apiKey = key();
      if (!apiKey) return Promise.reject(new Error('TomTom non configuré'));
      const now = clock().getTime();
      for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
      const cacheKey = `${point(from)}|${point(to)}|${arriveAt ? rfc3339(arriveAt) : 'maintenant'}`;
      const hit = cache.get(cacheKey);
      if (hit) return hit.result;
      const result = request(apiKey, from, to, arriveAt);
      result.catch(() => {});
      if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { at: now, result });
      return result;
    },
  };
}
