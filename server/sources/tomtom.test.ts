// Tests de la source TomTom (ligne voiture des parents) : requête avec le trafic, lecture de la réponse (faux TomTom),
// cache de 5 min, désactivée sans clé, panne notée sans la clé ni les positions.
import { describe, expect, it } from 'vitest';
import { NOW, silentLogger } from '../testing.ts';
import { createTomTomSource } from './tomtom.ts';
import { FAKE_TOMTOM_URL, fakeTomTomRoute } from './tomtom-fake.ts';

const FROM = { lat: 47.461, lon: -0.548 };
const TO = { lat: 47.48, lon: -0.55 };

function setup({ key = 'clé-secrète', status }: { key?: string; status?: number } = {}) {
  const urls: URL[] = [];
  const logger = silentLogger();
  let now = NOW.getTime();
  const source = createTomTomSource({
    key: () => key || undefined,
    baseUrl: FAKE_TOMTOM_URL,
    clock: () => new Date(now),
    logger,
    fetchFn: (async (u: string) => {
      urls.push(new URL(u));
      return status ? new Response('', { status }) : fakeTomTomRoute(new URL(u));
    }) as unknown as typeof fetch,
  });
  return { source, urls, logger, advance: (ms: number) => (now += ms) };
}

describe('TomTom', () => {
  it('demande le trajet le plus rapide avec le trafic, et lit durée, distance et retard', async () => {
    const { source, urls } = setup();
    const route = await source.route(FROM, TO);
    expect(urls[0].pathname).toBe('/routing/1/calculateRoute/47.46100,-0.54800:47.48000,-0.55000/json');
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({ key: 'clé-secrète', traffic: 'true', travelMode: 'car', routeType: 'fastest' });
    expect(route.trafficDelaySeconds).toBe(120);
    expect(route.meters).toBeGreaterThan(2000);
    expect(route.seconds).toBeGreaterThan(route.trafficDelaySeconds);
  });

  it('réponse gardée 5 min', async () => {
    const { source, urls, advance } = setup();
    await source.route(FROM, TO);
    advance(4 * 60_000);
    await source.route(FROM, TO);
    expect(urls).toHaveLength(1);
    advance(60_000);
    await source.route(FROM, TO);
    expect(urls).toHaveLength(2);
  });

  it('sans clé : désactivée', async () => {
    const { source, urls } = setup({ key: '' });
    expect(source.enabled()).toBe(false);
    await expect(source.route(FROM, TO)).rejects.toThrow('non configuré');
    expect(urls).toEqual([]);
  });

  it('panne : erreur notée sans la clé ni les positions', async () => {
    const { source, logger } = setup({ status: 403 });
    await expect(source.route(FROM, TO)).rejects.toThrow('HTTP 403');
    expect(logger.errors).toEqual(['TomTom indisponible : HTTP 403']);
  });
});
