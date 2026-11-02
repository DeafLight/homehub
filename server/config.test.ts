import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig } from './config.ts';

const alex = { id: 'alex', name: 'Alex', color: '#5b8def' };

describe('parseConfig', () => {
  it('applique les valeurs par défaut', () => {
    const config = parseConfig({ members: [alex] });
    expect(config.family.name).toBe('Famille');
    expect(config.ui.idleTimeoutSeconds).toBe(180);
  });

  it.each([
    ['aucun membre', { members: [] }],
    ['identifiant en double', { members: [alex, { ...alex, name: 'Autre' }] }],
    ['identifiant réservé', { members: [{ ...alex, id: 'famille' }] }],
    ['identifiant avec majuscule', { members: [{ ...alex, id: 'Alex' }] }],
    ['couleur invalide', { members: [{ ...alex, color: 'bleu' }] }],
    ['délai trop court', { members: [alex], ui: { idleTimeoutSeconds: 5 } }],
    ['latitude hors limites', { members: [alex], weather: { label: 'X', latitude: 95, longitude: 0 } }],
    ['météo sans nom de lieu', { members: [alex], weather: { latitude: 48.85, longitude: 2.35 } }],
  ])('refuse : %s', (_, raw) => {
    expect(() => parseConfig(raw)).toThrow(/Configuration invalide/);
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
});
