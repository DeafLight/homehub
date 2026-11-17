// Tests de la lecture du flux VehiclePositions : lu à la demande, une lecture partagée toutes les 15 s, pas de nouvel
// essai pendant 30 s après une panne, dernière lecture servie 2 min au plus.
import { describe, expect, it } from 'vitest';
import { encodeVehiclePositions } from './gtfs-rt-encode.ts';
import { createVehiclePositionSource, VEHICLE_POSITIONS_URL } from './vehicle-positions.ts';

function setup() {
  let now = Date.UTC(2026, 10, 5, 7, 50);
  let fail = false;
  const urls: string[] = [];
  const errors: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    if (fail) return new Response('panne', { status: 503 });
    return new Response(encodeVehiclePositions([{ tripId: 'FICTIF-A-1', lat: 47.47, lon: -0.55, timestamp: now / 1000 }], now / 1000));
  }) as typeof fetch;
  const source = createVehiclePositionSource({ fetchFn, clock: () => new Date(now), logger: { log: () => {}, error: (m: string) => errors.push(m) } });
  return { source, urls, errors, tick: (ms: number) => (now += ms), failNext: (v: boolean) => (fail = v) };
}

describe('createVehiclePositionSource', () => {
  it('rien n’est lu avant la première demande ; lectures simultanées et rapprochées partagées', async () => {
    const { source, urls, tick } = setup();
    expect(urls).toEqual([]);
    const [a, b] = await Promise.all([source.vehicles(), source.vehicles()]);
    expect(a.map((v) => v.tripId)).toEqual(['FICTIF-A-1']);
    expect(b).toBe(a);
    tick(10_000);
    await source.vehicles();
    expect(urls).toEqual([VEHICLE_POSITIONS_URL]);
    tick(5_000);
    await source.vehicles();
    expect(urls).toHaveLength(2);
  });

  it('en panne : dernière lecture servie 2 min, pas de nouvel essai avant 30 s, puis vide', async () => {
    const { source, urls, errors, tick, failNext } = setup();
    await source.vehicles();
    failNext(true);
    tick(20_000);
    expect(await source.vehicles()).toHaveLength(1);
    expect(errors[0]).toContain('HTTP 503');
    tick(10_000);
    await source.vehicles();
    expect(urls).toHaveLength(2);
    tick(100_000);
    expect(await source.vehicles()).toEqual([]);
    expect(urls).toHaveLength(3);
  });
});
