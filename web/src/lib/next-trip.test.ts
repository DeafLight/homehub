// Tests des textes de la carte « Prochain trajet » : heure de partir, heures, rendez-vous, pastilles d'étapes et
// retard, autre choix ou course suivante, ligne voiture, et position (refusée : null). Version 2.1 : rendez-vous
// lointain (jour et heure), point de départ du calcul, position demandée seulement dans les 3 h, raisons d'un trajet
// absent, diagnostic de la notification.
import { describe, expect, it } from 'vitest';
import type { NextTrip, TripOption, TripWatch } from '../../../shared/trip.ts';
import {
  carLine,
  currentPosition,
  delayLine,
  destinationLine,
  distanceText,
  durationText,
  leaveLine,
  leaveTitle,
  legChips,
  missingText,
  needsPosition,
  originLine,
  otherLine,
  watchLines,
} from './next-trip.ts';

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

describe('trajet d’un rendez-vous touché', () => {
  const tomorrow = (h: number, m = 0) => new Date(2026, 10, 6, h, m).toISOString();

  it('lointain : l’heure de partir avec le jour, le rendez-vous avec son jour', () => {
    expect(leaveTitle(at(14, 10), NOW)).toBe('Pars à 14 h 10');
    expect(leaveTitle(tomorrow(8, 12), NOW)).toBe('Pars demain à 8 h 12');
    expect(leaveLine({ ...option, leaveAt: tomorrow(8, 12), arrives: tomorrow(8, 41) }, NOW)).toBe('pour y être à 8 h 41');
    expect(leaveLine(option, NOW)).toBe('à 7 h 22, pour y être à 7 h 46');
    expect(destinationLine({ ...trip.destination, start: tomorrow(9, 30) }, NOW)).toBe('Maths · demain 9 h 30 · Collège');
    expect(destinationLine(trip.destination, NOW)).toBe('Maths · 8 h 00 · Collège');
  });

  it('point de départ dit clairement', () => {
    expect(originLine(trip)).toBe('Calculé depuis ta position actuelle.');
    expect(originLine({ ...trip, from: 'home', homeBecause: 'far' })).toBe('Calculé depuis la maison : le rendez-vous est dans plus de 3 h.');
    expect(originLine({ ...trip, from: 'home', homeBecause: 'tablet' })).toBe('Calculé depuis la maison.');
    expect(originLine({ ...trip, from: 'home' })).toBe('Calculé depuis la maison : position du téléphone indisponible.');
  });

  it('position demandée seulement pour un rendez-vous des 3 h', () => {
    expect(needsPosition(`rdv@${at(9, 0)}`, NOW)).toBe(true);
    expect(needsPosition(`rdv@${at(11, 0)}`, NOW)).toBe(false);
    expect(needsPosition(`rdv@${at(7, 0)}`, NOW)).toBe(false);
    expect(needsPosition('illisible', NOW)).toBe(false);
  });

  it('trafic habituel pour un rendez-vous lointain ; raisons d’un trajet absent', () => {
    expect(carLine({ minutes: 14, leaveAt: at(8, 36), traffic: true, typical: true, mapsUrl: '' }).detail).toBe('trafic habituel à cette heure');
    expect(missingText('here', true)).toBe('Tu es déjà sur place.');
    expect(missingText(undefined, false)).toBe('Les itinéraires ne sont pas configurés (MOTIS).');
  });
});

describe('diagnostic de la notification', () => {
  const next = { kind: 'event' as const, title: 'Dentiste', start: at(9, 0), place: 'Cabinet', leaveAt: at(8, 20) };

  it('rendez-vous suivi et heure de la notification', () => {
    expect(watchLines({ enabled: true, next, unplaced: [] })).toEqual(['Prochain rendez-vous suivi : Dentiste à 9 h 00, Cabinet. Départ de la maison à 8 h 20, notification vers 8 h 15.']);
    expect(watchLines({ enabled: true, next: { ...next, leaveAt: null }, unplaced: [] })[0]).toContain('pas de notification');
    expect(watchLines({ enabled: true, next: { ...next, kind: 'course', byCommute: true, leaveAt: null }, unplaced: [] })[0]).toContain('trajet du matin');
  });

  it('rien dans les 3 h, lieu non reconnu et pourquoi, MOTIS absent', () => {
    const watch: TripWatch = { enabled: true, next: null, unplaced: [{ title: 'Goûter', start: at(8, 30), location: 'chez Mamie', reason: 'not-found' }] };
    expect(watchLines(watch)).toEqual([
      'Aucun rendez-vous situé dans les 3 h.',
      'Goûter à 8 h 30 : lieu « chez Mamie » non reconnu (adresse introuvable ou incertaine).',
      'Écris l’adresse complète (numéro, rue, ville) ou le nom exact d’un lieu de la page Transports.',
    ]);
    expect(watchLines({ enabled: false, next: null, unplaced: [] })[0]).toContain('MOTIS');
  });
});
