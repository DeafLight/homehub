// Météo par Open-Meteo (https://open-meteo.com), avec les modèles de Météo-France (AROME, ARPEGE).
// Gratuit et sans clé pour un usage non commercial. Les réponses sont mises en cache : quelques appels par heure.
import { z } from 'zod';
import type { Weather } from '../../shared/types.ts';
import type { WeatherConfig } from '../config.ts';
import type { Logger } from '../config-store.ts';
import type { Clock, WeatherSource } from './types.ts';

const API_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 10_000;
/** En cas de panne de l'API, la dernière prévision reste affichée tant qu'elle a moins de 6 h. */
const STALE_MAX_MS = 6 * 3_600_000;
const RAIN_HORIZON_HOURS = 12;
/** Cumul horaire à partir duquel on parle de pluie (mm). */
const RAIN_THRESHOLD_MM = 0.2;

const responseSchema = z.object({
  current: z.object({ temperature_2m: z.number(), weather_code: z.number(), is_day: z.number() }),
  hourly: z.object({ time: z.array(z.number()), precipitation: z.array(z.number().nullable()) }),
  daily: z.object({
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
  }),
});

type OpenMeteoResponse = z.infer<typeof responseSchema>;

export type OpenMeteoDeps = {
  /** Lu à chaque appel : le lieu peut changer avec la configuration. undefined = pas de météo. */
  location(): WeatherConfig | undefined;
  clock: Clock;
  logger: Logger;
  fetch?: typeof fetch;
};

export function buildForecastUrl(location: WeatherConfig): string {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,weather_code,is_day',
    hourly: 'precipitation',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    models: 'meteofrance_seamless',
    timezone: 'Europe/Paris',
    forecast_days: '2',
    timeformat: 'unixtime',
  });
  return `${API_URL}?${params}`;
}

/** Convertit la réponse d'Open-Meteo au format de l'API HomeHub. */
export function toWeather(data: OpenMeteoResponse, label: string, now: Date): Weather {
  const { current, hourly, daily } = data;
  const nowSeconds = now.getTime() / 1000;
  const horizon = nowSeconds + RAIN_HORIZON_HOURS * 3600;
  // Premier créneau horaire pluvieux qui n'est pas encore terminé (il peut avoir commencé : il pleut).
  const rainIndex = hourly.time.findIndex(
    (start, i) => start + 3600 > nowSeconds && start < horizon && (hourly.precipitation[i] ?? 0) >= RAIN_THRESHOLD_MM,
  );
  const hasTomorrow = daily.weather_code.length > 1;

  return {
    location: label,
    temperatureC: current.temperature_2m,
    weatherCode: current.weather_code,
    isDay: current.is_day === 1,
    today: { minC: daily.temperature_2m_min[0], maxC: daily.temperature_2m_max[0] },
    tomorrow: hasTomorrow
      ? { minC: daily.temperature_2m_min[1], maxC: daily.temperature_2m_max[1], weatherCode: daily.weather_code[1] }
      : null,
    rainStartsAt: rainIndex === -1 ? null : new Date(hourly.time[rainIndex] * 1000).toISOString(),
  };
}

export function createOpenMeteoWeatherSource({
  location,
  clock,
  logger,
  fetch: fetchFn = (...args) => fetch(...args),
}: OpenMeteoDeps): WeatherSource {
  let cache: { url: string; fetchedAt: number; data: OpenMeteoResponse } | null = null;
  // Une seule requête à la fois : l'accueil et un dashboard peuvent demander la météo en même temps.
  let inFlight: Promise<OpenMeteoResponse> | null = null;

  async function download(url: string): Promise<OpenMeteoResponse> {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Open-Meteo : HTTP ${res.status}`);
    return responseSchema.parse(await res.json());
  }

  return {
    async current() {
      const place = location();
      if (!place) return null;

      const url = buildForecastUrl(place);
      const now = clock();
      const age = cache?.url === url ? now.getTime() - cache.fetchedAt : Infinity;

      if (age > place.refreshMinutes * 60_000) {
        try {
          inFlight ??= download(url).finally(() => {
            inFlight = null;
          });
          cache = { url, fetchedAt: now.getTime(), data: await inFlight };
        } catch (err) {
          if (age > STALE_MAX_MS) throw err;
          logger.error(`${(err as Error).message} ; prévision précédente conservée.`);
        }
      }

      return toWeather(cache!.data, place.label, now);
    },
  };
}
