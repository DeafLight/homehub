// Tests des réglages des transports : repli sur le YAML, enregistrement de la page, trajet en vigueur et validation.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.ts';
import { createConfigStore } from '../config-store.ts';
import { fixedClock } from '../testing.ts';
import { createTransitSettingsStore, DEFAULT_ARRIVE_BEFORE, transitSettingsInput, type TransitSettingsInput } from './transit-settings.ts';

const config = createConfigStore(
  parseConfig({
    members: [
      { id: 'alex', name: 'Alex', color: '#5b8def' },
      { id: 'lea', name: 'Léa', color: '#3fb8a8', commute: { stop: '1ANRO', line: 'A', label: 'Collège', walkMinutes: 6, from: '07:15', to: '08:15' } },
      { id: 'tom', name: 'Tom', color: '#d96aa7', commute: { stop: '1MAIR', line: '3', towards: 'Centre', days: ['mer'] } },
    ],
    transit: { stops: [{ id: '1MAIR', label: 'Mairie' }] },
  }),
);
const by = { ownerId: 'alex', via: 'tablet' as const };
const tempPath = () => join(mkdtempSync(join(tmpdir(), 'homehub-transit-')), 'transit.json');

const place = (id: string, label: string, icon: 'home' | 'school' = 'home') => ({ id, label, icon, address: `1 rue ${label}, Angers`, lat: 47.47, lon: -0.55 });
const route = {
  line: '3',
  origin: '1MAIR',
  originName: 'Mairie',
  destination: '1LYCE',
  destinationName: 'Lycée',
  towards: 'Centre',
  headsigns: ['Centre-ville'],
  oneWay: false,
  rideMinutes: 12,
  walkFrom: 4,
  walkTo: 3,
};
const commute = {
  from: 'maison',
  to: 'college',
  route,
  mode: 'school' as const,
  days: [3, 1, 1],
  window: { from: '07:00', to: '09:00' },
  arriveBefore: 10,
  showBefore: 30,
  walkFrom: null,
  walkTo: 8,
};
const settings = (over: Partial<TransitSettingsInput> = {}) =>
  transitSettingsInput.parse({ places: [place('maison', 'Maison'), place('college', 'Collège', 'school')], commutes: { lea: commute }, stops: [], ...over });

describe('tant que la page n’a pas été enregistrée', () => {
  it('reprend les arrêts et les trajets du YAML', async () => {
    const store = createTransitSettingsStore({ path: tempPath(), clock: fixedClock, config });
    await store.load();
    expect(store.current()).toEqual({ places: [], commutes: {}, stops: [{ id: '1MAIR', label: 'Mairie' }], saved: false });
    expect(store.homeStops()).toEqual([{ id: '1MAIR', label: 'Mairie' }]);
    expect(store.commuteFor('alex')).toBeNull();
    expect(store.commuteFor('lea')).toEqual({
      line: 'A',
      origin: '1ANRO',
      headsigns: [],
      oneWay: true,
      label: 'Collège',
      walkFrom: 6,
      walkTo: 0,
      mode: 'window',
      days: [1, 2, 3, 4, 5],
      window: { from: '07:15', to: '08:15' },
      arriveBefore: DEFAULT_ARRIVE_BEFORE,
      showBefore: 30,
    });
    expect(store.commuteFor('tom')).toMatchObject({ headsigns: ['Centre'], oneWay: false, days: [3] });
  });
});

describe('après enregistrement', () => {
  it('la page remplace le YAML, et survit à une relecture', async () => {
    const path = tempPath();
    const store = createTransitSettingsStore({ path, clock: fixedClock, config });
    await store.load();
    const saved = await store.save(settings(), by);
    expect(saved.saved).toBe(true);
    expect(store.homeStops()).toEqual([]);
    expect(store.commuteFor('tom')).toBeNull(); // plus de repli sur le YAML

    const reread = createTransitSettingsStore({ path, clock: fixedClock, config });
    await reread.load();
    expect(reread.current()).toEqual(saved);
  });

  it('trajet de la page : arrêts, lieu d’arrivée, marche réglée ou celle de l’itinéraire', async () => {
    const store = createTransitSettingsStore({ path: tempPath(), clock: fixedClock, config });
    await store.load();
    await store.save(settings(), by);
    expect(store.commuteFor('lea')).toEqual({
      line: '3',
      origin: '1MAIR',
      destination: '1LYCE',
      headsigns: ['Centre-ville'],
      oneWay: false,
      label: 'Collège',
      walkFrom: 4,
      walkTo: 8,
      mode: 'school',
      days: [1, 3],
      window: { from: '07:00', to: '09:00' },
      arriveBefore: 10,
      showBefore: 30,
    });
    await store.save(settings({ commutes: { lea: { ...commute, route: null } } }), by);
    expect(store.commuteFor('lea')).toBeNull();
  });
});

describe('validation de la page', () => {
  const problem = (input: unknown) => transitSettingsInput.safeParse(input).error?.issues[0]?.message;
  const base = { places: [place('maison', 'Maison'), place('college', 'Collège')], commutes: {}, stops: [] };

  it('refuse les lieux en double et les trajets vers un lieu supprimé', () => {
    expect(problem({ ...base, places: [place('maison', 'Maison'), place('autre', 'maison')] })).toBe('deux lieux portent le même nom');
    expect(problem({ ...base, places: [place('maison', 'Maison'), place('maison', 'Autre')] })).toBe('lieux en double');
    expect(problem({ ...base, places: [place('maison', 'Maison')], commutes: { lea: commute } })).toBe('trajet vers un lieu supprimé');
  });

  it('refuse un trajet incohérent : même lieu, horaires inversés, carte trop tardive', () => {
    expect(problem({ ...base, commutes: { lea: { ...commute, to: 'maison' } } })).toBe('départ et arrivée identiques');
    expect(problem({ ...base, commutes: { lea: { ...commute, window: { from: '09:00', to: '07:00' } } } })).toBe('le début doit précéder la fin');
    expect(problem({ ...base, commutes: { lea: { ...commute, showBefore: 2 } } })).toBe('carte affichée au moins 5 min avant');
    expect(problem({ ...base, commutes: { lea: { ...commute, days: [] } } })).toBe('au moins un jour');
  });

  it('limite le nombre d’arrêts de l’accueil', () => {
    const stops = ['A1', 'A2', 'A3', 'A4', 'A5'].map((id) => ({ id }));
    expect(problem({ ...base, stops })).toBe("4 arrêts au plus à l'accueil");
  });
});
