import { describe, expect, it } from 'vitest';
import { FAMILY_ID } from '../shared/types.ts';
import { calendarsOf, hasCalendars, loadConfig, parseConfig, toPublicConfig } from './config.ts';

const alex = { id: 'alex', name: 'Alex', color: '#5b8def' };

describe('parseConfig', () => {
  it('applique les valeurs par défaut', () => {
    const config = parseConfig({ members: [alex] });
    expect(config.family.name).toBe('Famille');
    expect(config.ui.idleTimeoutSeconds).toBe(180);
    expect(config.ui.screensaverMinutes).toBe(5);
  });

  it.each([
    ['aucun membre', { members: [] }],
    ['identifiant en double', { members: [alex, { ...alex, name: 'Autre' }] }],
    ['identifiant réservé', { members: [{ ...alex, id: 'famille' }] }],
    ['identifiant avec majuscule', { members: [{ ...alex, id: 'Alex' }] }],
    ['couleur invalide', { members: [{ ...alex, color: 'bleu' }] }],
    ['délai trop court', { members: [alex], ui: { idleTimeoutSeconds: 5 } }],
    ['latitude hors limites', { members: [alex], weather: { label: 'X', latitude: 95, longitude: 0 } }],
    ['agenda mal nommé', { members: [{ ...alex, calendars: ['https://calendar.google.com/x.ics'] }] }],
    ['météo sans nom de lieu', { members: [alex], weather: { latitude: 48.85, longitude: 2.35 } }],
  ])('refuse : %s', (_, raw) => {
    expect(() => parseConfig(raw)).toThrow(/Configuration invalide/);
  });
});

describe('agendas', () => {
  const config = parseConfig({
    members: [{ ...alex, calendars: ['CAL_ALEX'] }, { id: 'lea', name: 'Léa', color: '#3fb8a8' }],
    family: { name: 'Famille', calendars: ['CAL_FAMILLE'] },
  });

  it('associe à chaque profil ses agendas', () => {
    expect(calendarsOf(config, 'alex')).toEqual(['CAL_ALEX']);
    expect(calendarsOf(config, 'lea')).toEqual([]);
    expect(calendarsOf(config, FAMILY_ID)).toEqual(['CAL_FAMILLE']);
    expect(hasCalendars(config)).toBe(true);
    expect(hasCalendars(parseConfig({ members: [alex] }))).toBe(false);
  });

  it('ne les expose pas dans la configuration publique', () => {
    expect(JSON.stringify(toPublicConfig(config, 'r'))).not.toContain('CAL_');
  });
});

describe('loadConfig', () => {
  it("charge le fichier d'exemple du dépôt", async () => {
    const config = await loadConfig('config/homehub.example.yaml');
    expect(config.members.map((m) => m.id)).toEqual(['alex', 'sam', 'lea', 'tom']);
    expect(config.weather).toMatchObject({ label: 'Paris', refreshMinutes: 15 });
  });

  it('signale un fichier absent', async () => {
    await expect(loadConfig('config/absent.yaml')).rejects.toThrow(/Impossible de lire/);
  });

  it('routines : étapes de tous les jours ou de certains jours, heures du week-end', () => {
    const config = parseConfig({
      members: [
        {
          id: 'lea',
          name: 'Léa',
          color: '#3fb8a8',
          routines: { morning: ['Dents', { step: 'Sport', days: ['mer', 'week-end'] }, { step: 'Cartable', days: ['semaine'] }] },
        },
      ],
      routines: { weekend: { morning: { from: '08:00', to: '12:00' } } },
    });
    expect(config.members[0].routines.morning).toEqual([
      { label: 'Dents', days: null },
      { label: 'Sport', days: [0, 3, 6] },
      { label: 'Cartable', days: [1, 2, 3, 4, 5] },
    ]);
    expect(config.routines.weekend?.morning).toEqual({ from: '08:00', to: '12:00' });
    expect(() => parseConfig({ members: [{ id: 'a', name: 'A', color: '#000000', routines: { morning: [{ step: 'X', days: ['lundi'] }] } }] })).toThrow();
    expect(() => parseConfig({ members: [{ id: 'a', name: 'A', color: '#000000', routines: { evening: ['X', { step: 'X', days: ['mar'] }] } }] })).toThrow();
  });
});
