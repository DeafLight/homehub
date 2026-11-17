// Tests du faux flux de positions du monde fictif : le tram A d'un itinéraire donné par le faux MOTIS, en approche de
// son arrêt de montée puis à l'heure le long de sa course, et un bus d'une autre course.
import { describe, expect, it } from 'vitest';
import { parseVehiclePositions } from './gtfs-rt.ts';
import { fakeMotisPlan, fakeVehiclePositions } from './motis-fake.ts';

const MIN = 60_000;

function tramOfPlan(time: number) {
  const url = new URL('http://motis.test/api/v5/plan');
  url.search = new URLSearchParams({ fromPlace: '47.47,-0.55', toPlace: '47.48,-0.55', time: new Date(time).toISOString(), arriveBy: 'true' }).toString();
  return fakeMotisPlan(url)
    .json()
    .then((body: { itineraries: { legs: { mode: string; tripId?: string; startTime: string }[] }[] }) => body.itineraries[1].legs.find((l) => l.mode === 'TRAM')!);
}

describe('fakeVehiclePositions', () => {
  it('le tram A attend deux arrêts avant sa montée, puis avance ; un bus d’une autre course en plus', async () => {
    const time = Date.UTC(2026, 10, 5, 8, 30);
    const tram = await tramOfPlan(time);
    const board = Date.parse(tram.startTime);
    const early = parseVehiclePositions(fakeVehiclePositions(board - 30 * MIN));
    const mine = early.find((v) => v.tripId === tram.tripId)!;
    expect(mine).toMatchObject({ stopId: 'QTES', status: 'in-transit', timestamp: Math.round((board - 30 * MIN) / 1000) - 8 });
    expect(early.some((v) => v.tripId === 'fake_9_autre_course')).toBe(true);
    const atStop = parseVehiclePositions(fakeVehiclePositions(board)).find((v) => v.tripId === tram.tripId)!;
    expect(atStop).toMatchObject({ stopId: 'TILL-A', status: 'stopped' });
    expect(atStop.lat).toBeCloseTo(47.4742, 3);
    expect(parseVehiclePositions(fakeVehiclePositions(board + 30 * MIN)).find((v) => v.tripId === tram.tripId)).toBeUndefined();
  });
});
