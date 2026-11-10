// Tests des bus et tram sans HTTP : passages de l'accueil, trajet sur plage horaire, direction, pannes d'Irigo.
import { describe, expect, it } from 'vitest';
import type { Departure } from '../../shared/types.ts';
import type { CommuteTrip } from '../sources/transit-settings.ts';
import { fixedClock, NOW, silentLogger } from '../testing.ts';
import { accessory } from './accessory.ts';
import { createTransitBoard, sameDirection } from './transit.ts';

/** Passage dans `minutes` minutes après NOW (lundi 2 novembre 2026, 18 h). */
const at = (minutes: number, line: string, destination: string): Departure => ({
  line,
  destination,
  at: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
  realtime: true,
});

const TRIP: CommuteTrip = {
  line: '03',
  origin: 'MAIRIE',
  headsigns: ['ANGERS Lycée David'],
  oneWay: false,
  walkFrom: 3,
  walkTo: 2,
  mode: 'window',
  days: [1],
  window: { from: '17:30', to: '18:30' },
  arriveBefore: 5,
  showBefore: 10,
};

function setup(options: { failing?: string[]; trip?: CommuteTrip | null; alertsFail?: boolean } = {}) {
  const logger = silentLogger();
  const calls: string[][] = [];
  const transit = {
    async departures(stopId: string) {
      if (options.failing?.includes(stopId)) throw new Error('délai dépassé');
      return {
        name: stopId === 'MAIRIE' ? 'Mairie' : undefined,
        departures: [at(2, '3', 'Lycée David'), at(4, '3', 'Centre'), at(6, 'A', 'Gare'), at(9, '3', 'Lycée David')],
      };
    },
    async alerts(lines?: string[]) {
      calls.push(lines ?? []);
      if (options.alertsFail) throw new Error('flux vide');
      return [{ id: 'travaux', lines: ['3'], title: 'Travaux' }];
    },
  };
  const board = createTransitBoard({
    transit,
    settings: {
      homeStops: () => [{ id: 'MAIRIE', lines: ['03'] }, { id: 'PANNE' }, { id: 'GARE', label: 'Gare' }],
      commuteFor: (ownerId) => (ownerId === 'lea' ? (options.trip === undefined ? TRIP : options.trip) : null),
    },
    coursesFor: async () => null,
    clock: fixedClock,
    logger,
  });
  return { board, logger, calls };
}

describe('sameDirection', () => {
  it('reconnaît la destination malgré « ANGERS », les accents et la casse', () => {
    expect(sameDirection('Lycée David', ['ANGERS Lycee DAVID'])).toBe(true);
    expect(sameDirection('Centre', ['ANGERS Lycée David'])).toBe(false);
    expect(sameDirection('Bois Rinier Nord', ['Bois Rinier'])).toBe(true);
  });
});

describe('createTransitBoard', () => {
  it('passages de l’accueil : lignes filtrées, arrêt en panne masqué, perturbations des lignes affichées', async () => {
    const { board, logger, calls } = setup({ failing: ['PANNE'] });
    const data = await board.departures();
    expect(data.stops.map((s) => [s.id, s.label, s.departures.length])).toEqual([
      ['MAIRIE', 'Mairie', 3],
      ['GARE', 'Gare', 4],
    ]);
    expect(data.stops[0]).not.toHaveProperty('lines');
    expect(calls).toEqual([['3', 'A']]);
    expect(data.alerts).toHaveLength(1);
    expect(logger.errors).toEqual(['Irigo indisponible : délai dépassé']);
  });

  it('trajet sur plage horaire : bonne ligne, bonne direction ; null en dehors ou sans trajet', async () => {
    const { board } = setup();
    const commute = await board.commute('lea');
    expect(commute).toMatchObject({ line: '3', stop: 'Mairie', walkMinutes: 3 });
    expect(commute?.departures.map((d) => d.destination)).toEqual(['Lycée David', 'Lycée David']);
    expect(commute).not.toHaveProperty('plan');
    expect(await board.commute('tom')).toBeNull();
    expect(await setup({ trip: { ...TRIP, window: { from: '07:00', to: '08:30' } } }).board.commute('lea')).toBeNull();
    expect(await setup({ trip: { ...TRIP, days: [2] } }).board.commute('lea')).toBeNull();
  });

  it('sens unique : toutes les courses de la ligne ; perturbations en panne : liste vide', async () => {
    const { board, logger } = setup({ trip: { ...TRIP, oneWay: true }, alertsFail: true });
    const commute = await board.commute('lea');
    expect(commute?.departures).toHaveLength(3);
    expect(commute?.alerts).toEqual([]);
    expect(logger.errors).toEqual(['Perturbations Irigo indisponibles : flux vide']);
  });

  it('Irigo en panne ou absent : pas de carte', async () => {
    expect(await setup({ failing: ['MAIRIE'] }).board.commute('lea')).toBeNull();
    const none = createTransitBoard({
      settings: { homeStops: () => [{ id: 'MAIRIE' }], commuteFor: () => TRIP },
      coursesFor: async () => null,
      clock: fixedClock,
      logger: silentLogger(),
    });
    expect(await none.departures()).toEqual({ stops: [], alerts: [] });
    expect(await none.commute('lea')).toBeNull();
  });

  it('selon l’emploi du temps, sans horaires théoriques : pas de carte', async () => {
    expect(await setup({ trip: { ...TRIP, mode: 'school', destination: 'LYCEE' } }).board.commute('lea')).toBeNull();
  });
});

describe('accessory', () => {
  it('rend la valeur, ou la valeur de repli et un message si la source échoue', async () => {
    const logger = silentLogger();
    expect(await accessory(logger, 'Météo indisponible', async () => 12, null)).toBe(12);
    expect(await accessory(logger, 'Météo indisponible', () => Promise.reject(new Error('503')), null)).toBeNull();
    expect(logger.errors).toEqual(['Météo indisponible : 503']);
  });
});
