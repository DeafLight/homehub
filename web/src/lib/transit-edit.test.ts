import { describe, expect, it } from 'vitest';
import type { TransitPlace, TransitSettings } from '../../../shared/types.ts';
import {
  boundedMinutes,
  endsKey,
  nearKey,
  newCommute,
  newPlaceId,
  nextIcon,
  placeAddress,
  placeInUse,
  routeChoices,
  routeKey,
  settingsProblem,
  suggestPlace,
  toggleDay,
  walkMinutes,
} from './transit-edit.ts';

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

describe('page « Transports » : saisies', () => {
  it('adresse d’un lieu existant : coordonnées à jour, itinéraires à revoir ; sinon nouveau lieu', () => {
    const settings: TransitSettings = { places: [{ ...home }, { ...school }], commutes: { lea: { ...newCommute([home, school]), route } }, stops: [], saved: true };
    placeAddress(settings, 'p1', { label: '3 rue des Lilas, Angers', lat: 47.5, lon: -0.56 });
    expect(settings.places[0]).toMatchObject({ address: '3 rue des Lilas, Angers', lat: 47.5, lon: -0.56, label: 'Maison' });
    expect(settings.commutes.lea.route).toBeNull();
    placeAddress(settings, 'new', { label: 'Stade, Angers', lat: 47.46, lon: -0.54 });
    expect(settings.places[2]).toMatchObject({ id: 'p3', icon: 'place', label: '', address: 'Stade, Angers' });
  });

  it('clés des arrêts proches et des itinéraires', () => {
    expect(nearKey(home)).toBe('47.47,-0.55');
    expect(endsKey(home, school)).toBe('47.47,-0.55>47.47,-0.55');
    expect(endsKey(home, undefined)).toBe('');
  });

  it('itinéraire déjà choisi gardé en tête s’il n’est plus proposé', () => {
    const other = { ...route, line: 'B', totalMinutes: 20 };
    expect(routeChoices(null, null)).toEqual([]);
    expect(routeChoices([other], null)).toEqual([other]);
    expect(routeChoices([other, { ...route, totalMinutes: 19 }], route).map(routeKey)).toEqual([routeKey(other), routeKey(route)]);
    expect(routeChoices([other], route)).toEqual([{ ...route, totalMinutes: 19 }, other]);
  });

  it('minutes saisies : bornées, arrondies ; marche vide = estimation', () => {
    expect(walkMinutes('')).toBeNull();
    expect(walkMinutes('abc')).toBeNull();
    expect(walkMinutes('7.4')).toBe(7);
    expect(walkMinutes('90')).toBe(60);
    expect(walkMinutes('-3')).toBe(0);
    expect(boundedMinutes('arriveBefore', '75')).toBe(60);
    expect(boundedMinutes('showBefore', '75')).toBe(75);
    expect(boundedMinutes('showBefore', '500')).toBe(120);
    expect(boundedMinutes('arriveBefore', 'x')).toBeNull();
  });
});
