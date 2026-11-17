// Tests de la source MOTIS : lecture des itinéraires (faux MOTIS du monde fictif), requête, cache d'une minute, pannes.
import { describe, expect, it } from 'vitest';
import { fixedClock, NOW, silentLogger } from '../testing.ts';
import { FAKE_MOTIS_STOPS, fakeMotisPlan } from './motis-fake.ts';
import { decodePolyline } from '../../shared/geo-path.ts';
import { createMotisSource, gtfsStopId, isTransitLeg, MOTIS_STATUS, parseCar, parsePlan } from './motis.ts';
import { createSourceStatus } from './source-status.ts';

const HOME = { lat: 47.47, lon: -0.55 };
const SCHOOL = { lat: 47.48, lon: -0.56 };
const ARRIVE = new Date(2026, 10, 5, 8, 20);

function setup(options: { url?: string; fail?: boolean; body?: unknown } = {}) {
  const urls: URL[] = [];
  const logger = silentLogger();
  const status = createSourceStatus(fixedClock);
  let now = NOW.getTime();
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url);
    if (options.fail) return new Response('panne', { status: 503 });
    if (options.body) return new Response(JSON.stringify(options.body));
    return fakeMotisPlan(url);
  }) as typeof fetch;
  const source = createMotisSource({ url: () => ('url' in options ? options.url : 'http://motis:8080/'), clock: () => new Date(now), logger, status, fetchFn });
  return { source, urls, logger, status, advance: (ms: number) => (now += ms) };
}

describe('parsePlan', () => {
  it('lit étapes, lignes, arrêts, heures prévues et réelles, course et tracé', async () => {
    const url = new URL(`http://motis/api/v5/plan?fromPlace=47.47,-0.55&toPlace=47.48,-0.56&time=${ARRIVE.toISOString()}&arriveBy=true`);
    const [early, late] = parsePlan(await fakeMotisPlan(url, { delayMinutes: 2 }).json());
    expect(Date.parse(early.legs[1].scheduledDeparts)).toBe(Date.parse(late.legs[1].scheduledDeparts) - 15 * 60_000);
    expect(late.legs.map((l) => [l.mode, l.line ?? null])).toEqual([['WALK', null], ['BUS', '3'], ['WALK', null], ['TRAM', 'A'], ['WALK', null]]);
    const bus = late.legs[1];
    expect(bus).toMatchObject({ headsign: 'Lycée', tripId: `fake_3_${Date.parse(bus.scheduledDeparts)}_2`, realtime: true, cancelled: false });
    expect(bus.from).toMatchObject({ name: FAKE_MOTIS_STOPS.depart.name, stopId: 'irigo_RALL' });
    expect(Date.parse(bus.departs) - Date.parse(bus.scheduledDeparts)).toBe(2 * 60_000);
    expect(bus.geometry?.precision).toBe(6);
    const path = decodePolyline(bus.geometry!.points, 6);
    expect(path[0]).toEqual([bus.from.lon, bus.from.lat]);
    expect(path.at(-1)).toEqual([bus.to.lon, bus.to.lat]);
    // Arrêts de la course : montée, trois arrêts intermédiaires, descente, horodatés (retard compris).
    expect(bus.stops?.map((s) => s.name)).toEqual([FAKE_MOTIS_STOPS.depart.name, 'Place des Essais', 'Rue Imaginaire', 'Pont du Modèle', FAKE_MOTIS_STOPS.change.name]);
    expect(bus.stops?.[0]).toMatchObject({ departs: bus.departs, scheduledDeparts: bus.scheduledDeparts });
    expect(bus.stops?.at(-1)).toMatchObject({ arrives: bus.arrives });
    expect(late.legs[0].stops).toBeUndefined();
    // Arrivée 2 min avant l'heure demandée.
    expect(late.arrives).toBe(new Date(ARRIVE.getTime() - 2 * 60_000).toISOString());
    expect(late.legs.filter(isTransitLeg).map((l) => l.line)).toEqual(['3', 'A']);
  });

  it('refuse une réponse qui n’a pas la forme de MOTIS', () => {
    expect(() => parsePlan({ itineraries: [{ legs: [] }] })).toThrow();
  });
});

describe('course entière (GET /api/v5/trip)', () => {
  it('demande la course par son identifiant et lit tous ses arrêts', async () => {
    const { source, urls } = setup();
    const [, late] = await source.plan({ from: HOME, to: SCHOOL, time: ARRIVE, arriveBy: true });
    const tram = late.legs[3];
    const course = await source.trip(tram.tripId!);
    expect(urls.at(-1)?.pathname).toBe('/api/v5/trip');
    expect(urls.at(-1)?.searchParams.get('tripId')).toBe(tram.tripId);
    const [leg] = course.legs;
    expect(leg.stops).toHaveLength(7);
    const board = leg.stops!.find((s) => s.stopId === tram.from.stopId)!;
    expect(board.departs).toBe(tram.departs);
    await source.trip(tram.tripId!);
    expect(urls.filter((u) => u.pathname === '/api/v5/trip')).toHaveLength(1); // gardée une minute
  });

  it('course inconnue : erreur', async () => {
    const { source } = setup();
    await expect(source.trip('inconnue')).rejects.toThrow('HTTP 404');
  });
});

describe('gtfsStopId', () => {
  it('retire le préfixe du flux, garde le reste de l’identifiant', () => {
    expect(gtfsStopId('irigo_RALL')).toBe('RALL');
    expect(gtfsStopId('fr-angers-reseau_ABC_1')).toBe('ABC_1');
    expect(gtfsStopId('RALL')).toBe('RALL');
  });
});

describe('createMotisSource', () => {
  it('désactivée sans adresse', async () => {
    const { source, urls } = setup({ url: undefined });
    expect(source.enabled()).toBe(false);
    await expect(source.plan({ from: HOME, to: SCHOOL, time: ARRIVE, arriveBy: true })).rejects.toThrow('non configuré');
    expect(urls).toEqual([]);
  });

  it('demande /api/v5/plan en arrivée au plus tard, et garde la réponse une minute', async () => {
    const { source, urls, status, advance } = setup();
    expect(source.enabled()).toBe(true);
    const request = { from: HOME, to: SCHOOL, time: ARRIVE, arriveBy: true };
    expect(await source.plan(request)).toHaveLength(2);
    const [url] = urls;
    expect(url.origin + url.pathname).toBe('http://motis:8080/api/v5/plan');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fromPlace: '47.470000,-0.550000',
      toPlace: '47.480000,-0.560000',
      time: ARRIVE.toISOString(),
      arriveBy: 'true',
      numItineraries: '5',
    });
    await source.plan(request);
    expect(urls).toHaveLength(1);
    advance(61_000);
    await source.plan(request);
    expect(urls).toHaveLength(2);
    expect(status.list()).toMatchObject([{ name: MOTIS_STATUS, ok: true }]);
  });

  it('panne : erreur gardée une minute, notée sans les positions', async () => {
    const { source, urls, logger, status, advance } = setup({ fail: true });
    const request = { from: HOME, to: SCHOOL, time: ARRIVE, arriveBy: true };
    await expect(source.plan(request)).rejects.toThrow('HTTP 503');
    await expect(source.plan(request)).rejects.toThrow('HTTP 503');
    expect(urls).toHaveLength(1);
    expect(logger.errors).toEqual(['MOTIS indisponible : HTTP 503']);
    expect(status.list()).toMatchObject([{ name: MOTIS_STATUS, ok: false, error: 'HTTP 503' }]);
    advance(61_000);
    await expect(source.plan(request)).rejects.toThrow();
    expect(urls).toHaveLength(2);
  });

  it('réponse illisible : erreur', async () => {
    const { source, logger } = setup({ body: { itineraries: 'non' } });
    await expect(source.plan({ from: HOME, to: SCHOOL, time: ARRIVE, arriveBy: true })).rejects.toThrow('réponse illisible');
    expect(logger.errors).toEqual(['MOTIS indisponible : réponse illisible']);
  });
});

describe('voiture (secours de TomTom)', () => {
  it('demande directModes=CAR et lit durée et distance', async () => {
    const { source, urls } = setup();
    const car = await source.car(HOME, SCHOOL, ARRIVE);
    expect(urls[0].searchParams.get('directModes')).toBe('CAR');
    expect(urls[0].searchParams.get('arriveBy')).toBe('false');
    expect(car?.seconds).toBeGreaterThan(0);
    expect(car?.meters).toBeGreaterThan(1000);
  });

  it('sans trajet direct en voiture : null', () => {
    expect(parseCar({ direct: [{ duration: 60, legs: [{ mode: 'WALK', distance: 80 }] }] })).toBeNull();
    expect(parseCar({})).toBeNull();
    expect(parseCar({ direct: [{ duration: 600, legs: [{ mode: 'CAR' }] }] })).toEqual({ seconds: 600 });
  });
});
