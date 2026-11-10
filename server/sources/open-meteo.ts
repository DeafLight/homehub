// Météo par Open-Meteo (https://open-meteo.com), avec les modèles de Météo-France (AROME, ARPEGE).
// Gratuit et sans clé pour un usage non commercial. Les réponses sont mises en cache : quelques appels par heure.
import { z } from 'zod';
import type { Weather, WeatherDay, WeatherForecast, WeatherHour } from '../../shared/types.ts';
import type { WeatherConfig } from '../config.ts';
import type { Logger } from '../config-store.ts';
import { createRefreshingCache } from './refreshing-cache.ts';
import type { SourceStatus } from './source-status.ts';
import type { Clock, WeatherSource } from './types.ts';

const API_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 10_000;
/** En cas de panne de l'API, la dernière prévision reste affichée tant qu'elle a moins de 6 h. */
const STALE_MAX_MS = 6 * 3_600_000;
const RAIN_HORIZON_HOURS = 12;
/** Cumul horaire à partir duquel on parle de pluie (mm). */
const RAIN_THRESHOLD_MM = 0.2;
/** Jours demandés : les modèles Météo-France couvrent environ 4 jours (au-delà, valeurs nulles). */
const FORECAST_DAYS = 4;
const FORECAST_HOURS = 24;

// Les valeurs détaillées sont facultatives ou nulles : Open-Meteo renvoie null au-delà de la portée du modèle.
const values = z.array(z.number().nullable());
const responseSchema = z.object({
  current: z.object({
    time: z.number().optional(),
    temperature_2m: z.number(),
    weather_code: z.number(),
    is_day: z.number(),
    apparent_temperature: z.number().nullish(),
    relative_humidity_2m: z.number().nullish(),
    wind_speed_10m: z.number().nullish(),
    wind_gusts_10m: z.number().nullish(),
    wind_direction_10m: z.number().nullish(),
  }),
  hourly: z.object({
    time: z.array(z.number()),
    precipitation: values,
    temperature_2m: values.optional(),
    weather_code: values.optional(),
    is_day: values.optional(),
  }),
  daily: z.object({
    time: z.array(z.number()).optional(),
    weather_code: values,
    temperature_2m_max: values,
    temperature_2m_min: values,
    precipitation_sum: values.optional(),
    wind_speed_10m_max: values.optional(),
    sunrise: values.optional(),
    sunset: values.optional(),
  }),
});

type OpenMeteoResponse = z.infer<typeof responseSchema>;

export type OpenMeteoDeps = {
  /** Lu à chaque appel : le lieu peut changer avec la configuration. undefined = pas de météo. */
  location(): WeatherConfig | undefined;
  clock: Clock;
  logger: Logger;
  /** Résultat de chaque chargement, pour la page « Le NAS ». */
  status?: SourceStatus;
  fetch?: typeof fetch;
};

export function buildForecastUrl(location: WeatherConfig): string {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current:
      'temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m',
    hourly: 'precipitation,temperature_2m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset',
    models: 'meteofrance_seamless',
    timezone: 'Europe/Paris',
    forecast_days: String(FORECAST_DAYS),
    timeformat: 'unixtime',
  });
  return `${API_URL}?${params}`;
}

/** Convertit la réponse d'Open-Meteo au format de l'API HomeHub. */
export function toWeather(data: OpenMeteoResponse, label: string, now: Date): Weather {
  const { current, hourly } = data;
  const nowSeconds = now.getTime() / 1000;
  const horizon = nowSeconds + RAIN_HORIZON_HOURS * 3600;
  // Premier créneau horaire pluvieux qui n'est pas encore terminé (il peut avoir commencé : il pleut).
  const rainIndex = hourly.time.findIndex(
    (start, i) => start + 3600 > nowSeconds && start < horizon && (hourly.precipitation[i] ?? 0) >= RAIN_THRESHOLD_MM,
  );
  const days = toDays(data);
  const today = days[0];

  return {
    location: label,
    temperatureC: current.temperature_2m,
    weatherCode: current.weather_code,
    isDay: current.is_day === 1,
    today: today ? { minC: today.minC, maxC: today.maxC } : { minC: current.temperature_2m, maxC: current.temperature_2m },
    tomorrow: days[1] ? { minC: days[1].minC, maxC: days[1].maxC, weatherCode: days[1].weatherCode } : null,
    rainStartsAt: rainIndex === -1 ? null : new Date(hourly.time[rainIndex] * 1000).toISOString(),
  };
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** Jours complets de la prévision (code, min et max connus), dans l'ordre. */
function toDays({ daily }: OpenMeteoResponse): WeatherDay[] {
  const days: WeatherDay[] = [];
  daily.weather_code.forEach((code, i) => {
    const minC = daily.temperature_2m_min[i];
    const maxC = daily.temperature_2m_max[i];
    if (code === null || minC === null || maxC === null) return;
    const at = (list: Array<number | null> | undefined) => list?.[i] ?? null;
    const time = at(daily.time);
    const sunrise = at(daily.sunrise);
    const sunset = at(daily.sunset);
    days.push({
      date: time === null ? '' : iso(time),
      weatherCode: code,
      minC,
      maxC,
      precipitationMm: at(daily.precipitation_sum),
      windMaxKmh: at(daily.wind_speed_10m_max),
      sunrise: sunrise === null ? null : iso(sunrise),
      sunset: sunset === null ? null : iso(sunset),
    });
  });
  return days;
}

/** Prévision détaillée : conditions actuelles, 24 prochaines heures, jours couverts par le modèle. */
export function toForecast(data: OpenMeteoResponse, label: string, now: Date): WeatherForecast {
  const { current, hourly } = data;
  const hourStart = Math.floor(now.getTime() / 3_600_000) * 3600;
  const hours: WeatherHour[] = [];
  hourly.time.forEach((start, i) => {
    const temperatureC = hourly.temperature_2m?.[i];
    if (start < hourStart || hours.length >= FORECAST_HOURS + 1 || temperatureC == null) return;
    hours.push({
      time: iso(start),
      temperatureC,
      precipitationMm: hourly.precipitation[i] ?? 0,
      weatherCode: hourly.weather_code?.[i] ?? current.weather_code,
      isDay: (hourly.is_day?.[i] ?? current.is_day) === 1,
    });
  });

  return {
    location: label,
    observedAt: current.time === undefined ? now.toISOString() : iso(current.time),
    current: {
      temperatureC: current.temperature_2m,
      apparentC: current.apparent_temperature ?? null,
      weatherCode: current.weather_code,
      isDay: current.is_day === 1,
      humidityPct: current.relative_humidity_2m ?? null,
      windKmh: current.wind_speed_10m ?? null,
      gustsKmh: current.wind_gusts_10m ?? null,
      windFromDeg: current.wind_direction_10m ?? null,
    },
    hours,
    days: toDays(data),
  };
}

export function createOpenMeteoWeatherSource({
  location,
  clock,
  logger,
  status,
  fetch: fetchFn = (...args) => fetch(...args),
}: OpenMeteoDeps): WeatherSource {
  const cache = createRefreshingCache<OpenMeteoResponse>({
    clock,
    logger,
    status,
    staleMaxMs: STALE_MAX_MS,
    async load(url) {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return responseSchema.parse(await res.json());
    },
  });

  // Résumé et prévision détaillée viennent de la même réponse, mise en cache une seule fois.
  async function fetchFor(): Promise<{ data: OpenMeteoResponse; label: string } | null> {
    const place = location();
    if (!place) return null;
    const data = await cache.get(buildForecastUrl(place), place.refreshMinutes * 60_000, 'Open-Meteo');
    return { data, label: place.label };
  }

  return {
    async current() {
      const result = await fetchFor();
      return result && toWeather(result.data, result.label, clock());
    },
    async forecast() {
      const result = await fetchFor();
      return result && toForecast(result.data, result.label, clock());
    },
  };
}
