// Tests du tri des positions réelles : course MOTIS ramenée au trip_id du GTFS, âge de la position, courses absentes
// ou sans heure écartées, doublons fusionnés.
import { describe, expect, it } from 'vitest';
import type { GtfsRtVehicle } from '../sources/gtfs-rt.ts';
import { vehicleFixes } from './trip-vehicles.ts';

const NOW = Date.UTC(2026, 10, 5, 7, 50);
const T = NOW / 1000;
const FEED: GtfsRtVehicle[] = [
  { tripId: 'FICTIF-A-1', lat: 47.47, lon: -0.55, timestamp: T - 40, stopId: 'JEXE', status: 'in-transit' },
  { tripId: 'FICTIF-3-2', lat: 47.46, lon: -0.56, bearing: 180, timestamp: T + 3 },
  { tripId: 'FICTIF-B-3', lat: 47.48, lon: -0.54 },
];

describe('vehicleFixes', () => {
  it('retrouve la course MOTIS dans le flux, sans rien renvoyer d’autre', () => {
    expect(vehicleFixes(FEED, ['20261105_07:42_irigo_FICTIF-A-1'], NOW)).toEqual([
      { tripId: '20261105_07:42_irigo_FICTIF-A-1', lat: 47.47, lon: -0.55, age: 40, stopId: 'JEXE', status: 'in-transit' },
    ]);
  });

  it('identifiant d’une autre forme gardé tel quel ; heure dans le futur : âge 0 ; doublon fusionné', () => {
    expect(vehicleFixes(FEED, ['FICTIF-3-2', 'FICTIF-3-2'], NOW)).toEqual([{ tripId: 'FICTIF-3-2', lat: 47.46, lon: -0.56, bearing: 180, age: 0 }]);
  });

  it('course absente du flux, ou position sans heure : rien', () => {
    expect(vehicleFixes(FEED, ['20261105_08:00_irigo_ABSENTE', 'FICTIF-B-3'], NOW)).toEqual([]);
  });
});
