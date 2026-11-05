import { describe, expect, it } from 'vitest';
import type { TransitPlace, TransitSettings } from '../../../shared/types.ts';
import { newCommute, newPlaceId, nextIcon, placeInUse, settingsProblem, suggestPlace, toggleDay } from './transit-edit.ts';

const place = (id: string, label: string, icon: TransitPlace['icon']): TransitPlace => ({ id, label, icon, address: label, lat: 47.47, lon: -0.55 });
const home = place('p1', 'Maison', 'home');
const school = place('p2', 'Collège', 'school');
const route = { line: 'A', origin: '1MAIR', originName: 'Mairie', destination: '1LYC', destinationName: 'Lycée', towards: 'X', headsigns: ['X'], oneWay: true, rideMinutes: 12, walkFrom: 4, walkTo: 3 };

describe('page « Transports »', () => {
  it('propose la maison, puis l’école, et des identifiants libres', () => {
    expect(suggestPlace([])).toEqual({ label: 'Maison', icon: 'home' });
    expect(suggestPlace([home])).toEqual({ label: 'École', icon: 'school' });
    expect(suggestPlace([home, school]).icon).toBe('place');
    expect(newPlaceId([home, { id: 'p3' }])).toBe('p4');
    expect(nextIcon('place')).toBe('home');
    expect(toggleDay([1, 3], 2)).toEqual([1, 2, 3]);
  });

  it('crée un trajet maison → école, en semaine, selon l’emploi du temps', () => {
    expect(newCommute([school, home])).toMatchObject({ from: 'p1', to: 'p2', mode: 'school', days: [1, 2, 3, 4, 5], walkFrom: null, route: null });
  });

  it('dit ce qui empêche d’enregistrer', () => {
    const settings: Omit<TransitSettings, 'saved'> = { places: [home, school], commutes: { lea: { ...newCommute([home, school]), route } }, stops: [] };
    const nameOf = () => 'Léa';
    expect(settingsProblem(settings, nameOf)).toBeNull();
    expect(placeInUse(settings, 'p2')).toBe(true);
    expect(settingsProblem({ ...settings, places: [home, { ...school, label: ' maison ' }] }, nameOf)).toBe('Deux lieux s’appellent « maison »');
    expect(settingsProblem({ ...settings, commutes: { lea: { ...settings.commutes.lea, route: null } } }, nameOf)).toBe('Trajet de Léa : choisis une ligne');
    expect(settingsProblem({ ...settings, commutes: { lea: { ...settings.commutes.lea, days: [] } } }, nameOf)).toBe('Trajet de Léa : choisis au moins un jour');
  });
});
