// Tests des textes de la carte « Prochain trajet » : heure de partir, heures, rendez-vous, pastilles d'étapes et
// retard, autre choix ou course suivante, ligne voiture, et position (refusée : null).
import { describe, expect, it } from 'vitest';
import type { NextTrip, TripOption } from '../../../shared/trip.ts';
import { carLine, currentPosition, delayLine, destinationLine, distanceText, durationText, leaveLine, leaveTitle, legChips, otherLine } from './next-trip.ts';

const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m).toISOString();
const NOW = new Date(2026, 10, 5, 7, 16);

const option: TripOption = {
  leaveAt: at(7, 22),
  arrives: at(7, 46),
  realtime: true,
  legs: [
    { mode: 'walk', departs: at(7, 22), arrives: at(7, 28), minutes: 6 },
    { mode: 'tram', line: 'A', from: 'Ralliement', to: 'Les Collèges', departs: at(7, 29), arrives: at(7, 41), minutes: 12, delayMinutes: 3 },
    { mode: 'walk', departs: at(7, 41), arrives: at(7, 46), minutes: 5 },
  ],
};
const trip: NextTrip = {
  destination: { kind: 'course', title: 'Maths', start: at(8, 0), place: 'Collège', lat: 47.48, lon: -0.55 },
  arriveBy: at(7, 50),
  from: 'position',
  transit: option,
  other: { ...option, leaveAt: at(7, 7), arrives: at(7, 31), legs: [option.legs[0], { ...option.legs[1], mode: 'bus', line: '3' }] },
  late: false,
};

describe('carte « Prochain trajet »', () => {
  it('heure de partir en gros', () => {
    expect(leaveTitle(at(7, 22), NOW)).toBe('Pars dans 6 min');
    expect(leaveTitle(at(7, 16), NOW)).toBe('Pars maintenant');
    expect(leaveTitle(at(8, 30), NOW)).toBe('Pars dans 1 h 14');
    expect(leaveTitle(at(7, 14), NOW)).toBe('Trop tard pour celui-ci');
    expect(durationText(60)).toBe('1 h 00');
  });

  it('heures et rendez-vous', () => {
    expect(leaveLine(option)).toBe('à 7 h 22, pour y être à 7 h 46');
    expect(destinationLine(trip.destination)).toBe('Maths · 8 h 00 · Collège');
  });

  it('étapes en pastilles, avec le retard', () => {
    expect(legChips(option)).toEqual([
      { mode: 'walk', text: 'à pied 6 min' },
      { mode: 'tram', text: 'tram A 7 h 29', delay: '+3 min' },
      { mode: 'walk', text: 'à pied 5 min' },
    ]);
    expect(delayLine(option)).toBe('Tram A : 3 min de retard');
    expect(delayLine({ ...option, legs: [option.legs[0]] })).toBeNull();
  });

  it('autre choix, ou course suivante en retard', () => {
    expect(otherLine(trip)).toBe('Autre choix : pars à 7 h 07, arrivée 7 h 31 · bus 3');
    const later = { ...trip, other: { ...trip.other!, leaveAt: at(7, 37), arrives: at(8, 1) } };
    expect(otherLine(later)).toBe('Course suivante : pars à 7 h 37, arrivée 8 h 01 (en retard) · bus 3');
    expect(otherLine({ ...trip, other: null })).toBeNull();
  });

  it('ligne voiture : durée, heure de départ, trafic et distance', () => {
    const url = 'https://www.google.com/maps/dir/?api=1&destination=47.480000,-0.550000&travelmode=driving';
    expect(carLine({ minutes: 14, leaveAt: at(8, 36), meters: 4800, traffic: true, mapsUrl: url })).toEqual({ minutes: '14 min', leave: 'pars à 8 h 36', detail: 'trafic actuel compris · 4,8 km', url });
    expect(carLine({ minutes: 12, leaveAt: at(8, 38), traffic: false, mapsUrl: url }).detail).toBe('sans trafic');
    expect(distanceText(760)).toBe('800 m');
  });

  it('position refusée ou absente : null', async () => {
    expect(await currentPosition(undefined)).toBeNull();
    const refused = { getCurrentPosition: (_ok: PositionCallback, ko: PositionErrorCallback) => ko({ code: 1 } as GeolocationPositionError) } as Geolocation;
    expect(await currentPosition(refused)).toBeNull();
    const given = { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 47.46, longitude: -0.55 } } as GeolocationPosition) } as Geolocation;
    expect(await currentPosition(given)).toEqual({ lat: 47.46, lon: -0.55 });
  });
});
