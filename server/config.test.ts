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
    expect(config.trustedProxies).toEqual([]); // aucun proxy cru par défaut
    expect(config.faces.backend).toBe('webgl');
  });

  it('caméra en direct : activée par défaut, bandeau et son compris ; au front, ni serveurs ni durée', () => {
    const config = parseConfig({ members: [alex] });
    expect(config.camera).toEqual({ live: true, banner: true, audio: true, maxMinutes: 10, stun: [], turn: [] });
    expect(toPublicConfig(config, 'r').camera).toEqual({ live: true, banner: true });
    const off = parseConfig({ members: [alex], camera: { banner: false, turn: ['turn:maison.example.org:3478?transport=udp'] } });
    expect(toPublicConfig(off, 'r').camera).toEqual({ live: true, banner: false });
    expect(JSON.stringify(toPublicConfig(off, 'r'))).not.toContain('turn:');
    expect(() => parseConfig({ members: [alex], camera: { turn: ['https://maison.example.org'] } })).toThrow();
  });

  it('calcul des empreintes : choisi dans homehub.yaml, transmis à la tablette', () => {
    const config = parseConfig({ members: [alex], faces: { backend: 'webgl-safe' } });
    expect(config.faces.threshold).toBe(0.55); // les autres réglages gardent leur valeur par défaut
    expect(toPublicConfig(config, 'r').faces).toEqual({ minConfidence: 0.5, minSize: 0, backend: 'webgl-safe' });
    expect(parseConfig({ members: [alex], faces: { backend: 'cpu' } }).faces.backend).toBe('cpu');
    expect(() => parseConfig({ members: [alex], faces: { backend: 'gpu' } })).toThrow();
  });

  it('accepte des proxys de confiance en adresses ou en plages CIDR', () => {
    const proxies = ['172.20.0.0/16', '172.20.0.5', 'fd00::/8', '::1'];
    expect(parseConfig({ members: [alex], trustedProxies: proxies }).trustedProxies).toEqual(proxies);
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
    ['programme de sport pour un enfant', { members: [{ ...alex, fitness: true }] }],
    ['proxy de confiance qui n’est pas une adresse', { members: [alex], trustedProxies: ['npm'] }],
    ['plage de proxys invalide', { members: [alex], trustedProxies: ['172.20.0.0/40'] }],
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

  it('signale dans la configuration publique qui a un programme de sport', () => {
    const config = parseConfig({ members: [{ ...alex, parent: true, fitness: true }, { ...alex, id: 'lea' }] });
    expect(toPublicConfig(config, 'r').members.map((m) => m.fitness)).toEqual([true, undefined]);
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
});
