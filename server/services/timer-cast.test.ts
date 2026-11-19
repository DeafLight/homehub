// Tests de la sonnerie des minuteurs sur un Google Home : fichier WAV calculé (en-tête, durée), enceintes proposées,
// sonnerie lue par le faux appareil Cast à l'adresse des médias, arrêt du lecteur quand le minuteur est arrêté,
// « Aucune » ou appareil disparu : rien (journal seulement), appareil injoignable : rien ne lève.
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../config.ts';
import { createScreenAlertStore } from '../sources/screen-alerts.ts';
import { type FakeCastDevice, startFakeCastDevice } from './cast-fake.ts';
import { buildRingtone, RINGTONE_RATE, RINGTONE_SECONDS, ringtone } from './ringtone.ts';
import { createTimerCast, timerCastDevices } from './timer-cast.ts';

const quiet = { log: () => {}, error: () => {} };

describe('fichier de la sonnerie', () => {
  it('WAV PCM mono 16 bits, de la durée voulue, ni muet ni saturé', () => {
    const wav = ringtone();
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(RINGTONE_RATE);
    expect(wav.readUInt32LE(40)).toBe(RINGTONE_SECONDS * RINGTONE_RATE * 2);
    expect(wav.length).toBe(44 + RINGTONE_SECONDS * RINGTONE_RATE * 2);
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    expect(peak).toBeGreaterThan(10_000);
    expect(peak).toBeLessThanOrEqual(32_000);
    // Fondu : le dernier échantillon est (presque) silencieux.
    expect(Math.abs(wav.readInt16LE(wav.length - 2))).toBeLessThan(200);
    expect(buildRingtone(1, 8000).length).toBe(44 + 16_000);
  });
});

const castConfig = (port: number, mediaUrl: string | undefined = 'http://127.0.0.1:3010/') =>
  parseConfig({
    members: [{ id: 'alex', name: 'Alex', color: '#5b8def', parent: true }],
    cast: {
      ...(mediaUrl && { mediaUrl }),
      devices: [
        { id: 'salon', name: 'Google Home du salon', host: '127.0.0.1', port },
        { id: 'tele', name: 'Télé', host: '127.0.0.1', port, kind: 'tv' },
      ],
    },
  }).cast;

describe('enceintes proposées', () => {
  it('les enceintes de cast.devices (pas la télé), seulement avec cast.mediaUrl', () => {
    expect(timerCastDevices(castConfig(8009))).toEqual([{ id: 'salon', name: 'Google Home du salon' }]);
    expect(timerCastDevices(castConfig(8009, ''))).toEqual([]);
  });
});

describe('sonnerie sur l’enceinte', () => {
  let device: FakeCastDevice | null = null;
  afterEach(async () => {
    await device?.close();
    device = null;
  });

  async function setup(timerCast: string | null, options: { playMs?: number } = {}) {
    device = await startFakeCastDevice(options);
    const alerts = createScreenAlertStore();
    await alerts.set({ timer: true, film: true, timerCast });
    const errors: string[] = [];
    const cast = createTimerCast({ rules: () => castConfig(device!.port), alerts, logger: { log: () => {}, error: (...a: unknown[]) => errors.push(a.join(' ')) } });
    return { cast, errors, device };
  }

  it('l’enceinte choisie lit la sonnerie servie par HomeHub, avec le nom du minuteur', async () => {
    const { cast, device } = await setup('salon');
    await cast.ring({ id: 't1', label: 'Pâtes' });
    expect(device.plays).toEqual([{ url: 'http://127.0.0.1:3010/api/cast/ringtone.wav', contentType: 'audio/wav', title: 'Pâtes' }]);
    await cast.ring({ id: 't2', label: '' });
    expect(device.plays[1]!.title).toBe('Minuteur');
  });

  it('minuteur arrêté pendant la sonnerie : le lecteur Cast est fermé', async () => {
    const { cast, device } = await setup('salon', { playMs: 5000 });
    await cast.ring({ id: 't1', label: 'Pâtes' });
    cast.stop('t1');
    cast.stop('t1'); // deuxième arrêt : rien
    cast.stop('inconnu');
    await new Promise((r) => setTimeout(r, 100));
    expect(device.stops).toBe(1);
  });

  it('« Aucune » : rien ; appareil retiré de la configuration : journal seulement', async () => {
    const { cast, device, errors } = await setup(null);
    await cast.ring({ id: 't1', label: 'Pâtes' });
    expect(device.launches).toBe(0);
    expect(errors).toEqual([]);
    const gone = await setup('cuisine');
    await gone.cast.ring({ id: 't1', label: 'Pâtes' });
    expect(gone.device.launches).toBe(0);
    expect(gone.errors[0]).toContain('« cuisine »');
  });

  it('appareil injoignable : la sonnerie ne lève jamais, l’échec va au journal', async () => {
    const alerts = createScreenAlertStore();
    await alerts.set({ timer: true, film: true, timerCast: 'salon' });
    const errors: string[] = [];
    const fake = await startFakeCastDevice();
    const port = fake.port;
    await fake.close();
    const cast = createTimerCast({ rules: () => castConfig(port), alerts, logger: { ...quiet, error: (...a: unknown[]) => errors.push(a.join(' ')) } });
    await expect(cast.ring({ id: 't1', label: 'Pâtes' })).resolves.toBeUndefined();
    expect(errors[0]).toContain('injoignable');
  });
});
