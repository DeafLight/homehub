// Tests de l'heure du coucher (routes et service) : réglages par défaut puis enregistrés par un parent à la tablette ;
// les trois temps poussés aux télés allumées une seule fois (rattrapage, télé éteinte qui attend) ; report, annulation
// et rétablissement par le téléphone d'un parent (bandeau, fin de l'écran de veille), refusés au téléphone d'un enfant.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BEDTIME_DEFAULTS, type BedtimeView } from '../shared/bedtime.ts';
import type { ScreenEventBody } from '../shared/screen.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { BEDTIME_PARENTS_ONLY, createBedtimeApi } from './bedtime-api.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createRouter } from './http.ts';
import { createBedtime } from './services/bedtime.ts';
import { createBedtimeStore } from './sources/bedtime.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { connectedFrom } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const ENABLED = { ...BEDTIME_DEFAULTS, enabled: true };

async function setup() {
  // Lundi 16 novembre 2026, heure modifiable par le test.
  let now = new Date(2026, 10, 16, 19, 0);
  const clock = () => new Date(now);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
        { id: 'tom', name: 'Tom', color: '#e0a03a' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-bedtime-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const sent: ScreenEventBody[] = [];
  let power: 'on' | 'standby' = 'on';
  const store = createBedtimeStore();
  const bedtime = createBedtime({
    store,
    hub: { power: () => power, send: async (_id, event) => (sent.push(event), { ok: true }) },
    screenIds: async () => ['salon'],
    holidays: async () => [],
    children: () => ['Léa', 'Tom'],
    nameOf: (id) => (id === 'alex' ? 'Alex' : null),
    clock,
    logger: { log: () => {}, error: () => {} },
  });
  const api = createRouter();
  api.route('/', createBedtimeApi({ bedtime, access }));
  const phone = async (owner: string) => (await devices.claim(devices.createCode(owner).code, `Téléphone ${owner}`))!.token;
  const tokens = { alex: await phone('alex'), lea: await phone('lea') };
  type Options = { from?: string; who?: string | null; token?: string; body?: unknown };
  const call = (method: string, path: string, { from = TABLET, who = 'alex', token, body }: Options = {}) =>
    api.request(
      path,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(who && from === TABLET && { 'X-Actor-Session': sessions.open(who, 10).token }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      connectedFrom(from),
    );
  const fromPhone = (owner: keyof typeof tokens) => ({ from: OTHER, token: tokens[owner] });
  return {
    call,
    fromPhone,
    bedtime,
    store,
    sent,
    setTime: (h: number, m: number) => (now = new Date(2026, 10, 16, h, m)),
    setPower: (p: typeof power) => (power = p),
  };
}

describe('réglages du coucher', () => {
  it('coupé par défaut, enregistré par un parent à la tablette', async () => {
    const { call, fromPhone } = await setup();
    const initial = (await (await call('GET', '/screens/bedtime', { who: null })).json()) as BedtimeView;
    expect(initial.settings).toEqual(BEDTIME_DEFAULTS);
    expect(initial.tonight.state).toBe('off');
    expect((await call('PUT', '/screens/bedtime', { who: 'lea', body: ENABLED })).status).toBe(403);
    expect((await call('PUT', '/screens/bedtime', { ...fromPhone('alex'), body: ENABLED })).status).toBe(403);
    const saved = await call('PUT', '/screens/bedtime', { body: ENABLED });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as BedtimeView).tonight).toMatchObject({ state: 'before', time: '20:30' });
  });

  it('heures vérifiées : le soir seulement, sept soirs, délais permis', async () => {
    const { call } = await setup();
    expect((await call('PUT', '/screens/bedtime', { body: { ...ENABLED, school: ENABLED.school.map(() => '08:00') } })).status).toBe(400);
    expect((await call('PUT', '/screens/bedtime', { body: { ...ENABLED, holidays: ['21:00'] } })).status).toBe(400);
    expect((await call('PUT', '/screens/bedtime', { body: { ...ENABLED, reminderMin: 7 } })).status).toBe(400);
    expect((await call('PUT', '/screens/bedtime', { body: { ...ENABLED, school: ENABLED.school.map((t, i) => (i === 0 ? null : t)) } })).status).toBe(200);
  });
});

describe('les trois temps sur la télé', () => {
  it('rappel, pause, écran de veille, une fois chacun', async () => {
    const { call, bedtime, sent, setTime } = await setup();
    await call('PUT', '/screens/bedtime', { body: ENABLED });
    setTime(20, 10);
    await bedtime.tick();
    expect(sent).toEqual([]);
    setTime(20, 15);
    await bedtime.tick();
    await bedtime.tick();
    expect(sent).toEqual([expect.objectContaining({ kind: 'reminder', reminder: 'bedtime', title: 'Coucher dans 15 min', subtitle: 'Léa et Tom : au lit à 20:30' })]);
    setTime(20, 30);
    await bedtime.tick();
    expect(sent[1]).toMatchObject({ kind: 'key', keys: ['pause'], notice: { title: 'C’est l’heure d’aller au lit', subtitle: 'Bonne nuit Léa et Tom !' } });
    setTime(20, 41);
    await bedtime.tick();
    await bedtime.tick();
    expect(sent[2]).toMatchObject({ kind: 'bedtime', action: 'sleep' });
    expect(sent).toHaveLength(3);
  });

  it('télé éteinte : le temps attend qu’elle s’allume, pendant le rattrapage seulement', async () => {
    const { call, bedtime, sent, setTime, setPower } = await setup();
    await call('PUT', '/screens/bedtime', { body: { ...ENABLED, sleepMin: 0 } });
    setPower('standby');
    setTime(20, 20);
    await bedtime.tick();
    expect(sent).toEqual([]);
    setPower('on');
    await bedtime.tick();
    expect(sent.map((e) => e.kind)).toEqual(['reminder']);
    // Allumée de nouveau à 21 h 10 : l'écran de veille de 20 h 30 est passé depuis plus d'une demi-heure.
    sent.length = 0;
    setTime(21, 10);
    await bedtime.tick();
    expect(sent).toEqual([]);
  });
});

describe('ce soir, depuis le téléphone d’un parent', () => {
  it('repousser d’un quart d’heure : bandeau, rappel pas renvoyé d’un coup, une heure au plus', async () => {
    const { call, fromPhone, bedtime, sent, setTime } = await setup();
    await call('PUT', '/screens/bedtime', { body: ENABLED });
    setTime(20, 20);
    await bedtime.tick();
    const res = await call('POST', '/screens/bedtime/postpone', fromPhone('alex'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as BedtimeView).tonight).toMatchObject({ time: '20:45', delayMin: 15, state: 'before' });
    expect(sent[1]).toMatchObject({ kind: 'reminder', title: 'Coucher repoussé à 20:45', subtitle: 'De la part d’Alex' });
    setTime(20, 31);
    await bedtime.tick();
    expect(sent[2]).toMatchObject({ kind: 'reminder', title: 'Coucher dans 14 min' });
    for (let i = 0; i < 3; i++) expect((await call('POST', '/screens/bedtime/postpone', fromPhone('alex'))).status).toBe(200);
    expect((await call('POST', '/screens/bedtime/postpone', fromPhone('alex'))).status).toBe(409);
  });

  it('annuler pendant l’écran de veille : il se ferme, plus rien ce soir ; rétablir', async () => {
    const { call, fromPhone, bedtime, sent, setTime } = await setup();
    await call('PUT', '/screens/bedtime', { body: ENABLED });
    setTime(20, 45);
    await bedtime.tick();
    expect(sent.map((e) => e.kind)).toEqual(['bedtime']);
    const res = await call('POST', '/screens/bedtime/cancel', fromPhone('alex'));
    expect(((await res.json()) as BedtimeView).tonight.state).toBe('cancelled');
    expect(sent.slice(1)).toEqual([
      expect.objectContaining({ kind: 'bedtime', action: 'wake' }),
      expect.objectContaining({ kind: 'reminder', title: 'Pas de coucher imposé ce soir' }),
    ]);
    setTime(20, 50);
    await bedtime.tick();
    expect(sent).toHaveLength(3);
    expect((await call('POST', '/screens/bedtime/cancel', fromPhone('alex'))).status).toBe(409);
    const restored = await call('POST', '/screens/bedtime/restore', fromPhone('alex'));
    expect(((await restored.json()) as BedtimeView).tonight).toMatchObject({ state: 'sleep', time: '20:30' });
    expect(sent[3]).toMatchObject({ title: 'Coucher rétabli à 20:30' });
    // Les temps passés ne repartent pas d'un coup.
    await bedtime.tick();
    expect(sent).toHaveLength(4);
  });

  it('refusé au téléphone d’un enfant ; le lendemain, tout est oublié', async () => {
    const { call, fromPhone, store } = await setup();
    await call('PUT', '/screens/bedtime', { body: ENABLED });
    const denied = await call('POST', '/screens/bedtime/cancel', fromPhone('lea'));
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toBe(BEDTIME_PARENTS_ONLY);
    expect(((await (await call('GET', '/screens/bedtime', fromPhone('lea'))).json()) as BedtimeView).tonight.state).toBe('before');
    await call('POST', '/screens/bedtime/cancel', fromPhone('alex'));
    expect(await store.evening('2026-11-17')).toMatchObject({ cancelled: false, delayMin: 0, sent: -1 });
  });
});

describe('essayer le rappel', () => {
  it('le bandeau tel qu’il paraîtra ce soir, à la tablette seulement', async () => {
    const { call, fromPhone, sent } = await setup();
    await call('PUT', '/screens/bedtime', { body: ENABLED });
    expect((await call('POST', '/screens/bedtime/test', fromPhone('alex'))).status).toBe(403);
    const res = await call('POST', '/screens/bedtime/test');
    expect(await res.json()).toEqual({ title: 'Coucher dans 15 min', subtitle: 'Léa et Tom : au lit à 20:30', screens: 1 });
    expect(sent).toHaveLength(1);
  });
});
