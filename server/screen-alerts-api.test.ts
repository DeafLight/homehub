// Tests de l'alerte des minuteurs sur les télés (fonction 3) : réglage lu par la tablette et changé par un parent,
// événement `timer` envoyé à chaque télé allumée quand un minuteur se termine (une fois), télé qui arrive tard,
// réglage coupé, « Arrêter » depuis la télé (minuteur qui sonne seulement, jeton de télé exigé) et bandeau retiré
// partout quand le minuteur est arrêté ailleurs.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_PROTOCOL_HEADER, type ScreenAlerts, type ScreenEvents, type ScreenPairingStart, type ScreenPairingState } from '../shared/screen.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createScreenAlertsApi, TIMER_NOT_RINGING } from './screen-alerts-api.ts';
import { createScreenApi, SCREENS_PARENTS_ONLY } from './screen-api.ts';
import { createScreenHub } from './services/screens.ts';
import { createTimerAlerts, LATE_MS, timerAlertText } from './services/timer-alerts.ts';
import { createVoiceMessages } from './services/voice-messages.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createScreenAlertStore } from './sources/screen-alerts.ts';
import { createScreenAppStore } from './sources/screen-apps.ts';
import { createScreenStore } from './sources/screens.ts';
import { createTimerStore } from './sources/timers.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const TV = '192.168.1.60';
const PROTOCOL = { [SCREEN_PROTOCOL_HEADER]: '1' };
const TABLET_AUTHOR = { ownerId: null, via: 'tablet' as const };

async function setup() {
  let now = NOW.getTime();
  const clock = () => new Date(now);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-screen-alerts-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const screens = createScreenStore({ path: join(dir, 'screens.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, screens, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const hub = createScreenHub({ clock, waitMs: 20 });
  const timers = createTimerStore({ clock });
  const alerts = createScreenAlertStore({ path: join(dir, 'screen-alerts.json') });
  const watcher = createTimerAlerts({ timers, screens, hub, alerts, clock });
  const api = createRouter();
  api.route('/', createScreenApi({ screens, apps: createScreenAppStore({ path: join(dir, 'apps.json'), clock }), hub, voice: createVoiceMessages({ rules: () => config.current().cast, clock }), config, household: createHousehold(config), access }));
  api.route('/', createScreenAlertsApi({ alerts, timers, access, clock }));

  type Options = { from?: string; token?: string; body?: unknown; headers?: Record<string, string> };
  const call = (method: string, path: string, { from = TV, token, body, headers }: Options = {}) =>
    api.request(
      path,
      { method, headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) },
      connectedFrom(from),
    );
  const tablet = (who: string | null = 'alex'): { from: string; headers: Record<string, string> } => ({ from: TABLET, headers: who ? { 'X-Actor-Session': sessions.open(who, 10).token } : {} });

  async function pairTv(name: string) {
    const start = (await (await call('POST', '/screen/pairing', { headers: PROTOCOL, body: {} })).json()) as ScreenPairingStart;
    const waiting = call('GET', `/screen/pairing/${start.id}`, { headers: PROTOCOL });
    await call('POST', '/screens', { ...tablet(), body: { code: start.code, name } });
    const state = (await (await waiting).json()) as ScreenPairingState;
    if (state.status !== 'paired') throw new Error('télé non appairée');
    return state.token;
  }
  /** La télé demande ses événements (et devient « allumée »). */
  const listen = async (token: string, after?: number) =>
    (await (await call('GET', `/screen/events${after === undefined ? '' : `?after=${after}`}`, { token, headers: PROTOCOL })).json()) as ScreenEvents;

  return { call, tablet, pairTv, listen, timers, watcher, dir, advance: (ms: number) => (now += ms) };
}

describe('Alerte des minuteurs sur les télés : réglage', () => {
  it('actif par défaut ; un parent reconnu à la tablette le coupe, enregistré dans le dossier d’état', async () => {
    const { call, tablet, dir } = await setup();
    expect(await (await call('GET', '/screens/alerts', tablet(null))).json()).toEqual({ timer: true } satisfies ScreenAlerts);
    const res = await call('PUT', '/screens/alerts', { ...tablet(), body: { timer: false } });
    expect(await res.json()).toEqual({ timer: false });
    expect(JSON.parse(readFileSync(join(dir, 'screen-alerts.json'), 'utf8'))).toEqual({ version: 1, alerts: { timer: false } });
    expect(await (await call('GET', '/screens/alerts', tablet(null))).json()).toEqual({ timer: false });
  });

  it('un enfant, personne, un autre appareil : refusé ; réglage mal formé : 400', async () => {
    const { call, tablet } = await setup();
    expect(await (await call('PUT', '/screens/alerts', { ...tablet('lea'), body: { timer: false } })).json()).toEqual({ error: SCREENS_PARENTS_ONLY });
    expect((await call('PUT', '/screens/alerts', { ...tablet(null), body: { timer: false } })).status).toBe(403);
    expect((await call('GET', '/screens/alerts')).status).toBe(403);
    expect((await call('PUT', '/screens/alerts', { ...tablet(), body: { timer: 'oui' } })).status).toBe(400);
  });
});

describe('Alerte des minuteurs sur les télés : envoi et arrêt', () => {
  it('textes du bandeau : nom du minuteur et durée, comme sur la tablette', () => {
    expect(timerAlertText({ label: 'Cuisson', durationSeconds: 600 })).toEqual({ title: 'Cuisson', subtitle: 'C’est l’heure ! (10 min)' });
    expect(timerAlertText({ label: '', durationSeconds: 5400 })).toEqual({ title: 'Minuteur', subtitle: 'C’est l’heure ! (1 h 30)' });
    expect(timerAlertText({ label: 'Dents', durationSeconds: 30 }).subtitle).toBe('C’est l’heure !');
  });

  it('minuteur terminé : chaque télé allumée reçoit l’alerte une fois ; rien avant la fin', async () => {
    const { pairTv, listen, timers, watcher, advance } = await setup();
    const salon = await pairTv('Télé du salon');
    const chambre = await pairTv('Télé de la chambre');
    const first = await listen(salon);
    await listen(chambre);
    const timer = timers.start('Cuisson', 600, TABLET_AUTHOR)!;
    await watcher.check();
    expect((await listen(salon, first.last)).events).toEqual([]);

    advance(600_000);
    await Promise.all([listen(salon), listen(chambre)]); // les télés redemandent sans cesse : toujours allumées
    await watcher.check();
    await watcher.check();
    const got = await listen(salon, first.last);
    expect(got.events).toEqual([{ seq: expect.any(Number), kind: 'timer', id: expect.any(String), timerId: timer.id, title: 'Cuisson', subtitle: 'C’est l’heure ! (10 min)' }]);
    expect((await listen(chambre)).events.map((e) => e.kind)).toEqual(['timer']);
    expect((await listen(salon, got.last)).events).toEqual([]);
  });

  it('télé éteinte à la fin : reçue à son retour s’il n’est pas trop tard ; au-delà de LATE_MS, rien', async () => {
    const { pairTv, listen, timers, watcher, advance } = await setup();
    const salon = await pairTv('Télé du salon');
    timers.start('Pâtes', 60, TABLET_AUTHOR);
    advance(61_000);
    await watcher.check();
    await listen(salon); // la télé se rallume
    await watcher.check();
    expect((await listen(salon)).events.map((e) => e.kind)).toEqual(['timer']);

    const chambre = await pairTv('Télé de la chambre');
    advance(LATE_MS);
    await listen(chambre);
    await watcher.check();
    expect((await listen(chambre)).events).toEqual([]);
  });

  it('réglage coupé : aucune alerte', async () => {
    const { call, tablet, pairTv, listen, timers, watcher, advance } = await setup();
    await call('PUT', '/screens/alerts', { ...tablet(), body: { timer: false } });
    const salon = await pairTv('Télé du salon');
    timers.start('Cuisson', 60, TABLET_AUTHOR);
    advance(60_000);
    await listen(salon);
    await watcher.check();
    expect((await listen(salon)).events).toEqual([]);
  });

  it('« Arrêter » sur une télé : le minuteur s’arrête partout, l’autre télé retire son bandeau', async () => {
    const { call, pairTv, listen, timers, watcher, advance } = await setup();
    const salon = await pairTv('Télé du salon');
    const chambre = await pairTv('Télé de la chambre');
    const timer = timers.start('Cuisson', 60, TABLET_AUTHOR)!;
    advance(60_000);
    await listen(salon);
    await watcher.check();
    const alert = (await listen(chambre)).events;
    expect(alert.map((e) => e.kind)).toEqual([]); // la chambre était éteinte à la fin…
    await watcher.check();
    const alerted = await listen(chambre); // … elle reçoit l'alerte à son retour
    expect(alerted.events.map((e) => e.kind)).toEqual(['timer']);

    const stop = await call('POST', `/screen/timers/${timer.id}/stop`, { token: salon, headers: PROTOCOL });
    expect(stop.status).toBe(204);
    expect(timers.list()).toEqual([]);
    await watcher.check();
    const after = alerted.last;
    expect((await listen(chambre, after)).events).toEqual([{ seq: expect.any(Number), kind: 'timer-clear', id: expect.any(String), timerId: timer.id }]);
    // Déjà arrêté (par la tablette, ou l'autre télé) : rien à faire, pas d'erreur.
    expect((await call('POST', `/screen/timers/${timer.id}/stop`, { token: chambre, headers: PROTOCOL })).status).toBe(204);
  });

  it('arrêt depuis la télé : minuteur qui sonne seulement, jeton de télé et bon protocole exigés', async () => {
    const { call, tablet, pairTv, timers } = await setup();
    const salon = await pairTv('Télé du salon');
    const timer = timers.start('Cuisson', 600, TABLET_AUTHOR)!;
    expect(await (await call('POST', `/screen/timers/${timer.id}/stop`, { token: salon, headers: PROTOCOL })).json()).toEqual({ error: TIMER_NOT_RINGING });
    expect((await call('POST', `/screen/timers/${timer.id}/stop`, { from: TABLET, headers: { ...PROTOCOL, ...tablet().headers } })).status).toBe(401);
    expect((await call('POST', `/screen/timers/${timer.id}/stop`, { token: salon })).status).toBe(426);
    expect(timers.list()).toHaveLength(1);
  });
});
