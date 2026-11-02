import { describe, expect, it } from 'vitest';
import type { WeatherConfig } from '../config.ts';
import { NOW, silentLogger } from '../testing.ts';
import { buildForecastUrl, createOpenMeteoWeatherSource, toWeather } from './open-meteo.ts';

const PARIS: WeatherConfig = { label: 'Paris', latitude: 48.85, longitude: 2.35, refreshMinutes: 15 };
const hour = (offset: number) => Math.floor(NOW.getTime() / 1000) + offset * 3600;

/** Réponse au format d'Open-Meteo (timeformat=unixtime), autour de NOW (18:00). */
function response(precipitation: number[] = [0, 0, 0, 0.6, 1.2, 0]) {
  return {
    current: { time: hour(0), interval: 900, temperature_2m: 9.2, weather_code: 3, is_day: 0 },
    hourly: { time: precipitation.map((_, i) => hour(i - 1)), precipitation },
    daily: { time: [0, 1], weather_code: [3, 61], temperature_2m_max: [13.3, 10.6], temperature_2m_min: [3.7, 4.7] },
  };
}

function fakeFetch(bodies: Array<unknown | Error>) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const body = bodies[Math.min(calls.length - 1, bodies.length - 1)];
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}

describe('toWeather', () => {
  it('convertit la réponse', () => {
    expect(toWeather(response(), 'Paris', NOW)).toEqual({
      location: 'Paris',
      temperatureC: 9.2,
      weatherCode: 3,
      isDay: false,
      today: { minC: 3.7, maxC: 13.3 },
      tomorrow: { minC: 4.7, maxC: 10.6, weatherCode: 61 },
      rainStartsAt: new Date(hour(2) * 1000).toISOString(),
    });
  });

  it('signale la pluie en cours (créneau commencé avant maintenant)', () => {
    const now = new Date(NOW.getTime() + 30 * 60_000);
    expect(toWeather(response([0, 0.8, 0]), 'Paris', now).rainStartsAt).toBe(new Date(hour(0) * 1000).toISOString());
  });

  it('ignore la bruine sous le seuil et les créneaux passés', () => {
    expect(toWeather(response([5, 0.1, 0.1]), 'Paris', NOW).rainStartsAt).toBeNull();
  });
});

describe('createOpenMeteoWeatherSource', () => {
  it('renvoie null sans lieu configuré, sans appeler l’API', async () => {
    const { fn, calls } = fakeFetch([response()]);
    const source = createOpenMeteoWeatherSource({ location: () => undefined, clock: () => NOW, logger: silentLogger(), fetch: fn });
    expect(await source.current()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('demande les modèles Météo-France pour le lieu configuré', () => {
    const url = new URL(buildForecastUrl(PARIS));
    expect(url.searchParams.get('latitude')).toBe('48.85');
    expect(url.searchParams.get('models')).toBe('meteofrance_seamless');
  });

  it('met la réponse en cache le temps de refreshMinutes, et suit un changement de lieu', async () => {
    let now = NOW;
    let place = PARIS;
    const { fn, calls } = fakeFetch([response()]);
    const source = createOpenMeteoWeatherSource({ location: () => place, clock: () => now, logger: silentLogger(), fetch: fn });

    await Promise.all([source.current(), source.current()]);
    now = new Date(NOW.getTime() + 10 * 60_000);
    await source.current();
    expect(calls).toHaveLength(1);

    now = new Date(NOW.getTime() + 16 * 60_000);
    await source.current();
    expect(calls).toHaveLength(2);

    place = { ...PARIS, label: 'Lyon', latitude: 45.76 };
    expect((await source.current())?.location).toBe('Lyon');
    expect(calls).toHaveLength(3);
  });

  it('garde la dernière prévision en cas de panne, puis abandonne après 6 h', async () => {
    let now = NOW;
    const logger = silentLogger();
    const { fn } = fakeFetch([response(), new Error('réseau coupé')]);
    const source = createOpenMeteoWeatherSource({ location: () => PARIS, clock: () => now, logger, fetch: fn });

    await source.current();
    now = new Date(NOW.getTime() + 60 * 60_000);
    expect((await source.current())?.temperatureC).toBe(9.2);
    expect(logger.errors[0]).toContain('réseau coupé');

    now = new Date(NOW.getTime() + 7 * 3_600_000);
    await expect(source.current()).rejects.toThrow('réseau coupé');
  });

  it('rejette une réponse HTTP en erreur ou mal formée', async () => {
    const logger = silentLogger();
    const http500 = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(
      createOpenMeteoWeatherSource({ location: () => PARIS, clock: () => NOW, logger, fetch: http500 }).current(),
    ).rejects.toThrow('HTTP 500');

    const { fn } = fakeFetch([{ current: {} }]);
    await expect(
      createOpenMeteoWeatherSource({ location: () => PARIS, clock: () => NOW, logger, fetch: fn }).current(),
    ).rejects.toThrow();
  });
});
