// Tests de la notification « Pars dans 5 min » : texte (ligne et heure, sans prénom), fenêtre des 5 min, une seule
// par trajet, trajet du matin et prochain rendez-vous (pas de doublon pour un cours qui a son trajet), abonnement
// d'un téléphone retiré ou périmé oublié.
import { describe, expect, it } from 'vitest';
import type { NextTrip } from '../../shared/trip.ts';
import type { Commute } from '../../shared/types.ts';
import type { PushRecord } from '../sources/push.ts';
import { silentLogger } from '../testing.ts';
import { commuteMessage, createTripPush, hourText, tripMessage } from './trip-push.ts';
import type { PushMessage, PushResult } from './web-push.ts';

const NOW = new Date(2026, 10, 5, 7, 40);
const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m).toISOString();

const commute = (departs: string): Commute => ({
  line: '3',
  stop: 'Ralliement',
  label: 'Collège',
  walkMinutes: 4,
  departures: [],
  alerts: [],
  plan: { departs, arrives: at(8, 18), leaveAt: at(7, 45), firstCourse: at(8, 30), firstCancelled: false, legs: [{ line: '3', from: 'Ralliement', to: 'Tilleuls', departs, arrives: at(8, 1) }, { line: 'A', from: 'Tilleuls', to: 'Collèges', departs: at(8, 5), arrives: at(8, 13) }] },
});

const trip = (leaveAt: string, kind: 'course' | 'event' = 'event'): NextTrip => ({
  destination: { kind, title: 'Dentiste', start: at(9, 0), place: 'Cabinet', lat: 47.47, lon: -0.55 },
  arriveBy: at(8, 55),
  from: 'home',
  transit: {
    leaveAt,
    arrives: at(8, 50),
    realtime: false,
    legs: [
      { mode: 'walk', departs: leaveAt, arrives: at(7, 49), minutes: 4 },
      { mode: 'tram', line: 'A', departs: at(7, 49), arrives: at(8, 10), minutes: 21 },
    ],
  },
  other: null,
  late: false,
});

describe('textes', () => {
  it('« 7 h 05 »', () => expect(hourText(new Date(2026, 10, 5, 7, 5))).toBe('7 h 05'));

  it('trajet du matin : heure de partir dans 5 min, ligne et correspondance, sans prénom', () => {
    expect(commuteMessage(commute(at(7, 49)), NOW.getTime())).toEqual({
      title: 'Pars dans 5 min',
      body: 'Bus 3 à 7 h 49 puis tram A · Ralliement · vers Collège',
      tag: 'trajet',
      url: '/m',
    });
    expect(commuteMessage(commute(at(7, 52)), NOW.getTime())).toBeNull(); // dans 8 min : pas encore
    expect(commuteMessage(commute(at(7, 42)), NOW.getTime())).toBeNull(); // partir il y a 2 min : trop tard
  });

  it('prochain rendez-vous : première course, et le rendez-vous', () => {
    expect(tripMessage(trip(at(7, 45)), NOW.getTime())).toMatchObject({ title: 'Pars dans 5 min', body: 'Tram A à 7 h 49 · Dentiste à 9 h 00' });
    expect(tripMessage(trip(at(7, 40)), NOW.getTime())?.title).toBe('Pars maintenant');
    expect(tripMessage({ ...trip(at(7, 45)), late: true }, NOW.getTime())).toBeNull();
  });

  it('touchée : le trajet du rendez-vous annoncé (agenda), ou l’accueil pour un cours', () => {
    const key = `rdv-1@${at(9, 0)}`;
    const withKey = { ...trip(at(7, 45)), destination: { ...trip(at(7, 45)).destination, key } };
    expect(tripMessage(withKey, NOW.getTime())?.url).toBe(`/m/agenda?trajet=${encodeURIComponent(key)}`);
    expect(tripMessage(trip(at(7, 45), 'course'), NOW.getTime())?.url).toBe('/m');
  });
});

function setup({ result = 'sent' as PushResult, devices = [{ id: 'tel-lea', ownerId: 'lea' }], hasCommute = true, planned = trip(at(7, 45), 'event'), trips = true } = {}) {
  let subs: PushRecord[] = [
    { deviceId: 'tel-lea', ownerId: 'lea', endpoint: 'https://push.exemple.test/1', keys: { p256dh: 'p', auth: 'a' }, prefs: { trips, notes: true } },
    { deviceId: 'tel-vieux', ownerId: 'lea', endpoint: 'https://push.exemple.test/2', keys: { p256dh: 'p', auth: 'a' }, prefs: { trips: true, notes: true } },
  ];
  const marked = new Set<string>();
  const sent: { to: string; message: PushMessage }[] = [];
  const push = createTripPush({
    store: {
      all: async () => subs,
      unsubscribe: async (id) => void (subs = subs.filter((s) => s.deviceId !== id)),
      markSent: async (key) => !marked.has(key) && Boolean(marked.add(key)),
    },
    devices: async () => devices,
    commuteOf: async () => commute(at(7, 49)),
    hasCommute: () => hasCommute,
    nextTrip: { plan: async () => planned },
    send: async (sub, message) => (sent.push({ to: sub.deviceId, message }), result),
    clock: () => new Date(NOW),
    logger: silentLogger(),
  });
  return { push, sent, subs: () => subs };
}

describe('envoi', () => {
  it('une notification par trajet, aux téléphones encore appairés ; le téléphone retiré est oublié', async () => {
    const { push, sent, subs } = setup();
    await push.tick();
    await push.tick();
    expect(sent.map((s) => `${s.to} ${s.message.body}`)).toEqual(['tel-lea Bus 3 à 7 h 49 puis tram A · Ralliement · vers Collège', 'tel-lea Tram A à 7 h 49 · Dentiste à 9 h 00']);
    expect(subs().map((s) => s.deviceId)).toEqual(['tel-lea']);
  });

  it('un cours qui a son trajet du matin : pas de seconde notification', async () => {
    const { push, sent } = setup({ planned: trip(at(7, 45), 'course') });
    await push.tick();
    expect(sent).toHaveLength(1);
  });

  it('« Pars dans 5 min » coupé dans les réglages du téléphone : rien', async () => {
    const { push, sent } = setup({ trips: false });
    await push.tick();
    expect(sent).toEqual([]);
  });

  it('abonnement périmé : oublié', async () => {
    const { push, subs } = setup({ result: 'gone' });
    await push.tick();
    expect(subs()).toEqual([]);
  });
});
