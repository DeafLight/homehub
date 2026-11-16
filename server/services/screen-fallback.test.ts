// Tests du secours d'une télé éteinte : raison (allumée, veille, injoignable), appareil de secours (réglé, aucun,
// première enceinte par défaut, rien sans cast.mediaUrl), annonce sur la télé ou sur le secours, refus « écran
// éteint » de l'appli rattrapé, télé qui n'a pas reçu le message à temps rattrapée (raison `silent`), réglages vus
// de la tablette.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_OFF_REASON, type RemotePower, type ScreenReport } from '../../shared/screen.ts';
import { parseConfig } from '../config.ts';
import { createScreenFallbackStore } from '../sources/screen-fallbacks.ts';
import { createScreenFallback, type CastDevice } from './screen-fallback.ts';
import { SCREEN_MISSED, SCREEN_SILENT } from './screens.ts';

const DEVICES = [
  { id: 'tele', name: 'Télé', host: '192.168.1.21', kind: 'tv' as const },
  { id: 'salon', name: 'Google Home du salon', host: '192.168.1.20' },
  { id: 'cuisine', name: 'Google Home de la cuisine', host: '192.168.1.22' },
];

function setup({ mediaUrl = 'http://192.168.1.10:3010' as string | null, power = 'on' as RemotePower } = {}) {
  const cast = parseConfig({ members: [{ id: 'alex', name: 'Alex', color: '#5b8def', parent: true }], cast: { ...(mediaUrl && { mediaUrl }), devices: DEVICES } }).cast;
  const store = createScreenFallbackStore({ path: join(mkdtempSync(join(tmpdir(), 'homehub-fallback-')), 'screen-fallbacks.json') });
  const state = { power };
  const fallback = createScreenFallback({ hub: { power: () => state.power }, cast: () => cast, store });
  const played: string[] = [];
  const toDevice = async (device: CastDevice) => void played.push(device.id);
  return { fallback, state, played, toDevice, store };
}

const ok = async (): Promise<ScreenReport> => ({ ok: true });

describe('secours d’une télé éteinte', () => {
  it('raison : aucune si allumée, sinon veille ou injoignable', () => {
    const { fallback, state } = setup();
    expect(fallback.reasonOf('t')).toBeNull();
    state.power = 'standby';
    expect(fallback.reasonOf('t')).toBe('standby');
    state.power = 'offline';
    expect(fallback.reasonOf('t')).toBe('offline');
  });

  it('appareil : première enceinte si jamais réglé, sinon le choix (ou aucun) ; rien sans cast.mediaUrl', async () => {
    const { fallback } = setup();
    expect((await fallback.deviceOf('t'))?.id).toBe('salon');
    expect(await fallback.choose('t', 'cuisine')).toBe(true);
    expect((await fallback.deviceOf('t'))?.id).toBe('cuisine');
    expect(await fallback.choose('t', null)).toBe(true);
    expect(await fallback.deviceOf('t')).toBeNull();
    expect(await fallback.choose('t', 'inconnu')).toBe(false);
    await fallback.forget('t');
    expect((await fallback.deviceOf('t'))?.id).toBe('salon');
    expect(await setup({ mediaUrl: null }).fallback.deviceOf('t')).toBeNull();
  });

  it('télé allumée : l’annonce passe par la télé', async () => {
    const { fallback, played, toDevice } = setup();
    expect(await fallback.announce('t', ok, toDevice, 'Télé du salon')).toEqual({ device: 'Télé du salon', fallback: null });
    expect(played).toEqual([]);
  });

  it('télé en veille ou injoignable : l’annonce part sur le Google Home, sans rien envoyer à la télé', async () => {
    const { fallback, state, played, toDevice } = setup({ power: 'standby' });
    const toScreen = async (): Promise<ScreenReport> => {
      throw new Error('la télé ne devait rien recevoir');
    };
    expect(await fallback.announce('t', toScreen, toDevice, 'Télé du salon')).toEqual({
      device: 'Google Home du salon',
      fallback: { reason: 'standby', notice: 'Télé éteinte : lu sur Google Home du salon.' },
    });
    state.power = 'offline';
    expect(await fallback.announce('t', toScreen, toDevice, 'Télé du salon')).toMatchObject({ fallback: { reason: 'offline' } });
    expect(played).toEqual(['salon', 'salon']);
  });

  it('la télé refuse, écran éteint juste avant : rattrapé par le secours ; autre refus : remonté', async () => {
    const { fallback, played, toDevice } = setup();
    const off = async (): Promise<ScreenReport> => ({ ok: false, reason: SCREEN_OFF_REASON });
    expect(await fallback.announce('t', off, toDevice, 'Télé du salon')).toMatchObject({ device: 'Google Home du salon', fallback: { reason: 'standby' } });
    const broken = async (): Promise<ScreenReport> => ({ ok: false, reason: 'message non téléchargé' });
    expect(await fallback.announce('t', broken, toDevice, 'Télé du salon')).toEqual({ refused: { ok: false, reason: 'message non téléchargé' } });
    expect(played).toEqual(['salon']);
  });

  it('télé qui n’a pas reçu le message à temps : secours (raison silent) ; reçu mais muette : remonté', async () => {
    const { fallback, played, toDevice } = setup();
    const asked: boolean[] = [];
    const missed = async (rescue: boolean): Promise<ScreenReport> => (asked.push(rescue), { ok: false, reason: SCREEN_MISSED });
    expect(await fallback.announce('t', missed, toDevice, 'Télé du salon')).toEqual({
      device: 'Google Home du salon',
      fallback: { reason: 'silent', notice: 'La télé n’a pas répondu : lu sur Google Home du salon.' },
    });
    const silent = async (): Promise<ScreenReport> => ({ ok: false, reason: SCREEN_SILENT });
    expect(await fallback.announce('t', silent, toDevice, 'Télé du salon')).toEqual({ refused: { ok: false, reason: SCREEN_SILENT } });
    expect(played).toEqual(['salon']);
    expect(asked).toEqual([true]);
  });

  it('sans secours : la télé ne doit pas se presser d’accuser réception, son refus remonte', async () => {
    const { fallback, played, toDevice } = setup();
    await fallback.choose('t', null);
    const asked: boolean[] = [];
    const missed = async (rescue: boolean): Promise<ScreenReport> => (asked.push(rescue), { ok: false, reason: SCREEN_MISSED });
    expect(await fallback.announce('t', missed, toDevice, 'Télé du salon')).toEqual({ refused: { ok: false, reason: SCREEN_MISSED } });
    expect(asked).toEqual([false]);
    expect(played).toEqual([]);
  });

  it('sans secours : la télé reçoit l’annonce même éteinte (comme avant)', async () => {
    const { fallback, played, toDevice } = setup({ power: 'standby' });
    await fallback.choose('t', null);
    let sent = 0;
    const toScreen = async (): Promise<ScreenReport> => (sent++, { ok: false, reason: SCREEN_OFF_REASON });
    expect(await fallback.announce('t', toScreen, toDevice, 'Télé du salon')).toEqual({ refused: { ok: false, reason: SCREEN_OFF_REASON } });
    expect(sent).toBe(1);
    expect(played).toEqual([]);
  });

  it('réglages pour la tablette : appareils proposés, choix de chaque télé, « auto » si jamais réglée', async () => {
    const { fallback } = setup();
    await fallback.choose('b', 'cuisine');
    expect(await fallback.settings(['a', 'b'])).toEqual({
      devices: DEVICES.map(({ id, name, kind }) => ({ id, name, kind: kind ?? 'speaker' })),
      screens: [
        { id: 'a', device: 'salon', auto: true },
        { id: 'b', device: 'cuisine', auto: false },
      ],
    });
    expect(await setup({ mediaUrl: null }).fallback.settings(['a'])).toEqual({ devices: [], screens: [{ id: 'a', device: null, auto: true }] });
  });
});
