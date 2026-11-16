// Tests du « Prochain trajet » : choix du rendez-vous (cours au lieu école, agenda reconnu par nom ou géocodé sûr et
// proche), fenêtre de 3 h, déjà sur place, itinéraire de MOTIS (faux MOTIS) en arriveBy et retard, ligne voiture
// des parents (faux TomTom, origine arrondie ; MOTIS sans trafic en secours), et rien sans MOTIS. Version 2.1 : trajet
// d'un rendez-vous touché (téléphone : les siens et la famille, position seulement dans les 3 h ; tablette : tous,
// depuis la maison), rendez-vous touchables d'une semaine, et diagnostic de la notification.
import { describe, expect, it } from 'vitest';
import { eventKey } from '../../shared/trip.ts';
import { type CalendarEvent, type CommuteSettings, FAMILY_ID, type SchoolCourse, type TransitPlace } from '../../shared/types.ts';
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
  eventsOf,
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
  /** Rendez-vous par profil (sinon `events` pour tous). */
  eventsOf?: Record<string, CalendarEvent[]>;
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
      events: (eventsOf ? (eventsOf[ownerId] ?? []) : events).filter((e) => Date.parse(e.start) >= range.from.getTime() && Date.parse(e.start) < range.to.getTime()),
    }),
    owners: () => ['alex', 'tom', 'lea', FAMILY_ID],
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
    expect(target).toEqual({ destination: { kind: 'event', title: 'Foot', start: at(9, 0), place: 'Stade', key: `Foot@${at(9, 0)}`, lat: 47.46, lon: -0.57 }, margin: 5 });
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

/** Vendredi 6 novembre 2026 (le lendemain). */
const tomorrow = (h: number, m = 0) => new Date(2026, 10, 6, h, m).toISOString();
const NEAR_PLACE = { lat: 47.475, lon: -0.56, label: '12 Rue des Lices 49100 Angers' };
const lices = (q: string) => (q.includes('Lices') ? NEAR_PLACE : null);

describe('rendez-vous touché', () => {
  it('téléphone, dans les 3 h : depuis la position, clé du rendez-vous dans la destination', async () => {
    const dentist = ev(at(9, 0), 'Dentiste', '12 rue des Lices');
    const { service, motisUrls } = setup({ eventsOf: { tom: [dentist] }, locate: lices });
    const { trip, missing } = await service.planEvent({ phone: 'tom' }, eventKey(dentist), FAR);
    expect(missing).toBeUndefined();
    expect(trip?.destination).toMatchObject({ kind: 'event', title: 'Dentiste', place: NEAR_PLACE.label, key: eventKey(dentist) });
    expect(trip?.from).toBe('position');
    expect(trip).not.toHaveProperty('homeBecause');
    expect(trip?.transit).not.toBeNull();
    expect(trip).not.toHaveProperty('car'); // enfant
    expect(motisUrls[0].searchParams.get('fromPlace')).toBe('47.461230,-0.547890');
    expect(motisUrls[0].searchParams.get('time')).toBe(at(8, 55));
  });

  it('téléphone, rendez-vous lointain : depuis la maison même avec une position, arriveBy le jour venu ; trafic habituel', async () => {
    const swim = ev(tomorrow(18, 0), 'Piscine', 'Stade');
    const { service, motisUrls, tomtomUrls } = setup({ eventsOf: { alex: [swim] }, parent: true, tomtomKey: 'clé-test' });
    const { trip } = await service.planEvent({ phone: 'alex' }, eventKey(swim), FAR);
    expect(trip?.from).toBe('home');
    expect(trip?.homeBecause).toBe('far');
    expect(motisUrls[0].searchParams.get('fromPlace')).toBe('47.470000,-0.550000');
    expect(motisUrls[0].searchParams.get('arriveBy')).toBe('true');
    expect(motisUrls[0].searchParams.get('time')).toBe(tomorrow(17, 55));
    expect(Date.parse(trip!.transit!.arrives)).toBeLessThanOrEqual(Date.parse(tomorrow(17, 55)));
    expect(trip?.car).toMatchObject({ traffic: true, typical: true });
    expect(tomtomUrls[0].searchParams.get('arriveAt')).toBe(tomorrow(17, 55).replace('.000Z', 'Z'));
  });

  it("téléphone : ceux de la famille aussi, jamais ceux d'un autre membre", async () => {
    const family = ev(at(9, 0), 'Cinéma', 'Stade');
    const sister = ev(at(9, 30), 'Danse', 'Stade');
    const { service } = setup({ eventsOf: { [FAMILY_ID]: [family], lea: [sister] } });
    expect((await service.planEvent({ phone: 'tom' }, eventKey(family), null)).trip?.destination.title).toBe('Cinéma');
    expect(await service.planEvent({ phone: 'tom' }, eventKey(sister), null)).toEqual({ trip: null, missing: 'event' });
    expect(await service.planEvent({ phone: 'tom' }, 'clé illisible', null)).toEqual({ trip: null, missing: 'event' });
  });

  it('tablette : tous les profils, depuis la maison, ligne voiture comprise, position ignorée', async () => {
    const sister = ev(at(9, 30), 'Danse', 'Stade');
    const { service, motisUrls } = setup({ eventsOf: { lea: [sister] } });
    const { trip } = await service.planEvent({ tablet: true }, eventKey(sister), FAR);
    expect(trip?.from).toBe('home');
    expect(trip?.homeBecause).toBe('tablet');
    expect(trip?.car).toMatchObject({ traffic: false });
    expect(motisUrls[0].searchParams.get('fromPlace')).toBe('47.470000,-0.550000');
  });

  it('pas de trajet : commencé, lieu non reconnu, à la maison ; sans MOTIS, rien', async () => {
    const started = ev(at(7, 0), 'Réunion', 'Stade');
    const unknown = ev(at(9, 0), 'Goûter', 'chez Mamie');
    const home = ev(at(9, 0), 'Apéro', 'Maison');
    const { service } = setup({ eventsOf: { alex: [started, unknown, home] }, locate: () => null });
    expect((await service.planEvent({ phone: 'alex' }, eventKey(started), null)).missing).toBe('past');
    expect((await service.planEvent({ phone: 'alex' }, eventKey(unknown), null)).missing).toBe('place');
    expect((await service.planEvent({ phone: 'alex' }, eventKey(home), null)).missing).toBe('here');
    expect(await setup({ eventsOf: { alex: [home] }, motisUrl: '' }).service.planEvent({ phone: 'alex' }, eventKey(home), null)).toEqual({ trip: null });
  });
});

describe('rendez-vous touchables', () => {
  const mine = ev(tomorrow(10, 0), 'Dentiste', '12 rue des Lices');
  const family = ev(tomorrow(15, 0), 'Cinéma', 'Stade');
  const other = ev(tomorrow(16, 0), 'Danse', 'Stade');
  const eventsOf = {
    alex: [mine, ev(tomorrow(11, 0), 'Goûter', 'chez Mamie'), ev(tomorrow(12, 0), 'Apéro', 'Maison'), ev(at(7, 0), 'Passé', 'Stade'), ev(tomorrow(0, 0), 'Férié', 'Stade', true), ev(tomorrow(9, 0), 'Sans lieu')],
    [FAMILY_ID]: [family],
    lea: [other],
  };

  it('téléphone : les siens et ceux de la famille dont le lieu est reconnu, à venir, hors de la maison', async () => {
    const { service, located } = setup({ eventsOf, locate: lices });
    expect((await service.routable({ phone: 'alex' }, 0)).sort()).toEqual([eventKey(mine), eventKey(family)].sort());
    await service.routable({ phone: 'alex' }, 0);
    expect(located).toEqual(['12 rue des Lices', 'chez Mamie']); // une recherche par lieu, gardée en mémoire
  });

  it('tablette : tous les profils ; semaine suivante vide', async () => {
    const { service } = setup({ eventsOf, locate: lices });
    expect((await service.routable({ tablet: true }, 0)).sort()).toEqual([eventKey(mine), eventKey(family), eventKey(other)].sort());
    expect(await service.routable({ tablet: true }, 1)).toEqual([]);
  });
});

describe('diagnostic de la notification', () => {
  it('rendez-vous suivi : heure de partir depuis la maison ; lieux non reconnus avant lui, avec la raison', async () => {
    const far = { lat: 48.11, lon: -1.68, label: 'Rennes' };
    const { service } = setup({
      eventsOf: { alex: [ev(at(8, 0), 'Loin', 'Rennes centre'), ev(at(8, 30), 'Goûter', 'chez Mamie'), ev(at(9, 0), 'Dentiste', '12 rue des Lices'), ev(at(9, 30), 'Après', 'Inconnu')] },
      locate: (q) => (q.includes('Lices') ? NEAR_PLACE : q.includes('Rennes') ? far : null),
    });
    const watch = await service.watch('alex');
    expect(watch.next).toMatchObject({ kind: 'event', title: 'Dentiste', start: at(9, 0), place: NEAR_PLACE.label });
    expect(watch.next?.leaveAt).toBeTruthy();
    expect(watch.unplaced).toEqual([
      { title: 'Loin', start: at(8, 0), location: 'Rennes centre', reason: 'too-far' },
      { title: 'Goûter', start: at(8, 30), location: 'chez Mamie', reason: 'not-found' },
    ]);
  });

  it('rien dans les 3 h ; recherche impossible ; cours pris par le trajet du matin ; sans MOTIS', async () => {
    expect(await setup({ eventsOf: { alex: [ev(at(11, 0), 'Tard', 'Stade')] } }).service.watch('alex')).toEqual({ enabled: true, next: null, unplaced: [] });
    const noSearch = await setup({ eventsOf: { alex: [ev(at(9, 0), 'Goûter', 'chez Mamie')] } }).service.watch('alex');
    expect(noSearch.unplaced[0].reason).toBe('no-search');
    const lea = await setup({ courses: [course(at(8, 0))] }).service.watch('lea');
    expect(lea.next).toMatchObject({ kind: 'course', byCommute: true, leaveAt: null });
    expect(await setup({ motisUrl: '' }).service.watch('alex')).toEqual({ enabled: false, next: null, unplaced: [] });
  });
});
