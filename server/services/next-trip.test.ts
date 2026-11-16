// Tests du « Prochain trajet » : choix du rendez-vous (cours au lieu école, agenda reconnu par nom ou géocodé sûr et
// proche), fenêtre de 3 h, déjà sur place, itinéraire de MOTIS (faux MOTIS) en arriveBy et retard, ligne voiture
// des parents (faux TomTom, origine arrondie ; MOTIS sans trafic en secours), et rien sans MOTIS.
import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CommuteSettings, SchoolCourse, TransitPlace } from '../../shared/types.ts';
import { fakeMotisPlan, type FakeMotisOptions } from '../sources/motis-fake.ts';
import { createMotisSource } from '../sources/motis.ts';
import { createTomTomSource } from '../sources/tomtom.ts';
import { FAKE_TOMTOM_URL, fakeTomTomRoute } from '../sources/tomtom-fake.ts';
import { silentLogger } from '../testing.ts';
import { createNextTripService, homePlaceOf, placeNamed, schoolPlaceOf } from './next-trip.ts';

/** Jeudi 5 novembre 2026, 7 h 30 (heure locale). */
const NOW = new Date(2026, 10, 5, 7, 30);
const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m).toISOString();
const PLACES: TransitPlace[] = [
  { id: 'maison', label: 'Maison', icon: 'home', address: 'Maison, Angers', lat: 47.47, lon: -0.55 },
  { id: 'college', label: 'Collège', icon: 'school', address: 'Collège, Angers', lat: 47.48, lon: -0.55 },
  { id: 'stade', label: 'Stade', icon: 'sport', address: 'Stade, Angers', lat: 47.46, lon: -0.57 },
];
const COMMUTE = { from: 'maison', to: 'college', arriveBefore: 10 } as CommuteSettings;
const FAR = { lat: 47.46123, lon: -0.54789 };
const course = (start: string, subject = 'Maths', cancelled = false): SchoolCourse => ({ id: start, subject, start, end: start, cancelled });
const ev = (start: string, title: string, location?: string, allDay = false): CalendarEvent => ({ id: title, title, start, location, allDay });

function setup({
  courses = [],
  events = [],
  parent = false,
  motis = {},
  motisUrl = 'http://motis.test',
  tomtomKey,
  tomtomStatus,
  now = NOW,
  locate,
}: {
  courses?: SchoolCourse[];
  events?: CalendarEvent[];
  parent?: boolean;
  motis?: FakeMotisOptions;
  motisUrl?: string;
  tomtomKey?: string;
  tomtomStatus?: number;
  now?: Date;
  locate?: (q: string) => { lat: number; lon: number; label: string } | null;
} = {}) {
  const clock = () => new Date(now);
  const logger = silentLogger();
  const motisUrls: URL[] = [];
  const tomtomUrls: URL[] = [];
  const located: string[] = [];
  const motisSource = createMotisSource({
    url: () => motisUrl || undefined,
    clock,
    logger,
    fetchFn: (async (u: string) => {
      motisUrls.push(new URL(u));
      return fakeMotisPlan(new URL(u), motis);
    }) as unknown as typeof fetch,
  });
  const tomtom = createTomTomSource({
    key: () => tomtomKey,
    baseUrl: FAKE_TOMTOM_URL,
    clock,
    logger,
    fetchFn: (async (u: string) => {
      tomtomUrls.push(new URL(u));
      return tomtomStatus ? new Response('', { status: tomtomStatus }) : fakeTomTomRoute(new URL(u));
    }) as unknown as typeof fetch,
  });
  const service = createNextTripService({
    appointments: async (ownerId, range) => ({
      courses: ownerId === 'lea' ? courses.filter((c) => Date.parse(c.start) >= range.from.getTime() && Date.parse(c.start) < range.to.getTime()) : [],
      events: events.filter((e) => Date.parse(e.start) >= range.from.getTime() && Date.parse(e.start) < range.to.getTime()),
    }),
    places: () => PLACES,
    commuteOf: (ownerId) => (ownerId === 'lea' ? COMMUTE : undefined),
    isParent: () => parent,
    center: () => ({ lat: 47.47, lon: -0.55 }),
    locate: locate && (async (q) => (located.push(q), locate(q))),
    motis: motisSource,
    tomtom,
    clock,
    logger,
  });
  return { service, motisUrls, tomtomUrls, located, logger };
}

describe('lieux', () => {
  it('reconnaît un lieu de la famille par son nom, sans accents ni casse', () => {
    expect(placeNamed(PLACES, ' college ')?.id).toBe('college');
    expect(placeNamed(PLACES, 'Stade, Angers')?.id).toBe('stade');
    expect(placeNamed(PLACES, 'Collège Jean Vilar')).toBeUndefined();
  });

  it("lieu école : l'arrivée du trajet, sinon le seul lieu école ; maison : le départ du trajet", () => {
    expect(schoolPlaceOf(PLACES, COMMUTE)?.id).toBe('college');
    expect(schoolPlaceOf(PLACES, undefined)?.id).toBe('college');
    expect(schoolPlaceOf([...PLACES, { ...PLACES[1], id: 'ecole', label: 'École' }], undefined)).toBeUndefined();
    expect(homePlaceOf(PLACES, undefined)?.id).toBe('maison');
  });
});

describe('prochain trajet', () => {
  it('cours dans les 3 h : vers le lieu école, arriver avant le cours moins la marge du trajet', async () => {
    const { service, motisUrls } = setup({ courses: [course(at(8, 30))] });
    const trip = await service.plan('lea', FAR);
    expect(trip?.destination).toEqual({ kind: 'course', title: 'Maths', start: at(8, 30), place: 'Collège', lat: 47.48, lon: -0.55 });
    expect(trip?.arriveBy).toBe(at(8, 20));
    expect(trip?.from).toBe('position');
    // Faux MOTIS : bus au plus tard 31 min avant l'heure demandée, 4 min de marche avant.
    expect(trip?.transit?.leaveAt).toBe(at(7, 45));
    expect(trip?.transit?.legs.map((l) => `${l.mode}${l.line ?? ''} ${l.minutes}`)).toEqual(['walk 4', 'bus3 12', 'walk 4', 'tramA 8', 'walk 3']);
    expect(trip?.other?.leaveAt).toBe(at(7, 30));
    expect(trip?.late).toBe(false);
    expect(trip).not.toHaveProperty('car');
    const url = motisUrls[0];
    expect(url.searchParams.get('arriveBy')).toBe('true');
    expect(url.searchParams.get('time')).toBe(at(8, 20));
    expect(url.searchParams.get('fromPlace')).toBe('47.461230,-0.547890');
  });

  it('retard annoncé par le temps réel, en minutes sur la course', async () => {
    const { service } = setup({ courses: [course(at(8, 30))], motis: { busDeparts: new Date(2026, 10, 5, 7, 40), delayMinutes: 3 } });
    const bus = (await service.plan('lea', FAR))?.transit?.legs.find((l) => l.mode === 'bus');
    expect(bus).toMatchObject({ line: '3', delayMinutes: 3, from: 'Ralliement', to: 'Mail des Tilleuls' });
  });

  it('course supprimée : itinéraire écarté, l’autre choix retenu', async () => {
    const { service } = setup({ courses: [course(at(8, 30))], motis: { cancelled: true } });
    const trip = await service.plan('lea', FAR);
    expect(trip?.transit?.leaveAt).toBe(at(7, 30));
    // Plus d'autre choix plus tôt : la course suivante (recherche au départ, après celle retenue).
    expect(trip?.other?.leaveAt).toBe(at(7, 41));
  });

  it('rien au-delà de 3 h, ni pour un cours annulé, ni déjà sur place', async () => {
    expect(await setup({ courses: [course(at(10, 31))] }).service.plan('lea', FAR)).toBeNull();
    expect(await setup({ courses: [course(at(8, 30), 'Maths', true)] }).service.plan('lea', FAR)).toBeNull();
    expect(await setup({ courses: [course(at(8, 30))] }).service.plan('lea', { lat: 47.4815, lon: -0.5505 })).toBeNull();
  });

  it('sans position : depuis la maison', async () => {
    const { service, motisUrls } = setup({ courses: [course(at(8, 30))] });
    expect((await service.plan('lea', null))?.from).toBe('home');
    expect(motisUrls[0].searchParams.get('fromPlace')).toBe('47.470000,-0.550000');
  });

  it('notification : seulement le premier cours de la journée', async () => {
    const { service } = setup({ courses: [course(at(7, 0)), course(at(9, 0))], now: new Date(2026, 10, 5, 7, 30) });
    expect(await service.destination('lea', { firstCourseOnly: true })).toBeNull();
    expect((await service.destination('lea'))?.destination.start).toBe(at(9, 0));
  });

  it("rendez-vous d'agenda : lieu de la famille par son nom, marge de 5 min", async () => {
    const { service, located } = setup({ events: [ev(at(9, 0), 'Foot', 'Stade')], locate: () => null });
    const target = await service.destination('tom');
    expect(target).toEqual({ destination: { kind: 'event', title: 'Foot', start: at(9, 0), place: 'Stade', lat: 47.46, lon: -0.57 }, margin: 5 });
    expect(located).toEqual([]);
  });

  it('lieu géocodé : seulement sûr et proche du centre ; sinon le rendez-vous suivant', async () => {
    const near = { lat: 47.475, lon: -0.56, label: '12 Rue des Lices 49100 Angers' };
    const far = { lat: 48.11, lon: -1.68, label: 'Rennes' };
    const { service, located } = setup({
      events: [ev(at(8, 0), 'Loin', 'Rennes centre'), ev(at(8, 30), 'Inconnu', 'chez Mamie'), ev(at(9, 0), 'Dentiste', '12 rue des Lices'), ev(at(8, 15), 'Journée', 'Stade', true)],
      locate: (q) => (q.includes('Lices') ? near : q.includes('Rennes') ? far : null),
    });
    const target = await service.destination('alex');
    expect(target?.destination).toMatchObject({ title: 'Dentiste', place: near.label });
    expect(located).toEqual(['Rennes centre', 'chez Mamie', '12 rue des Lices']);
    await service.destination('alex');
    expect(located).toHaveLength(3); // gardés en mémoire
  });

  it('trop tard pour arriver à temps : le prochain départ, marqué en retard', async () => {
    const { service, motisUrls } = setup({ courses: [course(at(8, 30))], now: new Date(2026, 10, 5, 7, 50) });
    const trip = await service.plan('lea', FAR);
    expect(motisUrls.map((u) => u.searchParams.get('arriveBy'))).toEqual(['true', 'false']);
    expect(trip?.late).toBe(true);
    expect(trip?.transit).not.toBeNull();
  });
});

describe('ligne voiture', () => {
  const event = [ev(at(9, 0), 'Dentiste', 'Stade')];

  it('parent : durée avec le trafic par TomTom, origine arrondie à 100 m, lien Google Maps', async () => {
    const { service, tomtomUrls } = setup({ events: event, parent: true, tomtomKey: 'clé-test' });
    const car = (await service.plan('alex', FAR, { car: true }))?.car;
    expect(car).toMatchObject({ traffic: true, mapsUrl: 'https://www.google.com/maps/dir/?api=1&destination=47.460000,-0.570000&travelmode=driving' });
    expect(car!.minutes).toBeGreaterThan(0);
    // Partir à 8 h 55 (rendez-vous à 9 h, marge 5 min) moins la durée.
    expect(Math.abs(Date.parse(at(8, 55)) - Date.parse(car!.leaveAt) - car!.minutes * 60_000)).toBeLessThan(31_000);
    expect(car!.meters).toBeGreaterThan(0);
    expect(tomtomUrls[0].pathname).toBe('/routing/1/calculateRoute/47.46100,-0.54800:47.46000,-0.57000/json');
    expect(tomtomUrls[0].href).not.toContain('47.46123');
  });

  it('sans clé ou TomTom en panne : MOTIS sans trafic', async () => {
    const noKey = await setup({ events: event, parent: true }).service.plan('alex', FAR, { car: true });
    expect(noKey?.car).toMatchObject({ traffic: false });
    const { service, motisUrls, logger } = setup({ events: event, parent: true, tomtomKey: 'clé', tomtomStatus: 503 });
    expect((await service.plan('alex', FAR, { car: true }))?.car?.traffic).toBe(false);
    expect(motisUrls.some((u) => u.searchParams.get('directModes') === 'CAR')).toBe(true);
    expect(logger.errors.join(' ')).not.toContain('47.46');
  });

  it('enfant, ou sans demande : pas de ligne voiture', async () => {
    expect(await setup({ events: event, tomtomKey: 'clé' }).service.plan('tom', FAR, { car: true })).not.toHaveProperty('car');
    expect(await setup({ events: event, parent: true, tomtomKey: 'clé' }).service.plan('alex', FAR)).not.toHaveProperty('car');
  });
});

describe('sans MOTIS', () => {
  it('pas de carte', async () => {
    const { service } = setup({ courses: [course(at(8, 30))], motisUrl: '' });
    expect(service.enabled()).toBe(false);
    expect(await service.plan('lea', FAR)).toBeNull();
  });
});
