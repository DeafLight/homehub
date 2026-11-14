// Tests des routes des rappels sur la télé : réglages lus par la tablette (par défaut, puis enregistrés), modifiés et
// essayés par un parent reconnu devant elle seulement ; heure et genre vérifiés.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScreenEventBody } from '../shared/screen.ts';
import { SCREEN_REMINDER_DEFAULTS, type ScreenReminderSettings } from '../shared/screen-reminders.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createRouter } from './http.ts';
import { SCREENS_PARENTS_ONLY } from './screen-api.ts';
import { createScreenRemindersApi } from './screen-reminders-api.ts';
import { createScreenReminders } from './services/screen-reminders.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createScreenReminderStore } from './sources/screen-reminders.ts';
import { createScreenStore } from './sources/screens.ts';
import { connectedFrom, fixedClock } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';

function setup() {
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-reminders-api-'));
  const sessions = createActorSessions(fixedClock);
  const access = createAccess({
    config,
    devices: createDeviceStore({ path: join(dir, 'devices.json'), clock: fixedClock }),
    screens: createScreenStore({ path: join(dir, 'screens.json'), clock: fixedClock }),
    isKey: kioskKeyMatcher(undefined),
    actorOf: (t) => sessions.get(t, 10),
  });
  const store = createScreenReminderStore({ path: join(dir, 'screen-reminders.json') });
  const sent: ScreenEventBody[] = [];
  const reminders = createScreenReminders({
    store,
    hub: { power: () => 'on', send: async (_id, event) => (sent.push(event), { ok: true }) },
    screenIds: async () => ['salon'],
    builders: { 'evening-routine': async () => ({ title: 'Routine du soir', subtitle: 'Léa : encore 1 étape' }), notes: async () => null },
    clock: fixedClock,
    logger: { log: () => {}, error: () => {} },
  });
  const api = createRouter();
  api.route('/', createScreenRemindersApi({ store, reminders, access, clock: fixedClock }));
  const call = (method: string, path: string, { from = TABLET, who = 'alex' as string | null, body = undefined as unknown } = {}) =>
    api.request(
      path,
      {
        method,
        headers: { 'Content-Type': 'application/json', ...(who && { 'X-Actor-Session': sessions.open(who, 10).token }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      connectedFrom(from),
    );
  return { call, sent };
}

describe('rappels sur la télé', () => {
  it('réglages par défaut, puis enregistrés par un parent', async () => {
    const { call } = setup();
    const initial = (await (await call('GET', '/screens/reminders', { who: null })).json()) as ScreenReminderSettings;
    expect(initial.reminders.map((r) => [r.kind, r.enabled, r.time])).toEqual([
      ['evening-routine', true, SCREEN_REMINDER_DEFAULTS['evening-routine'].time],
      ['notes', true, SCREEN_REMINDER_DEFAULTS.notes.time],
    ]);
    const saved = await call('PUT', '/screens/reminders', { body: { reminders: [{ kind: 'notes', enabled: false, time: '20:05' }] } });
    expect(saved.status).toBe(200);
    const after = (await (await call('GET', '/screens/reminders')).json()) as ScreenReminderSettings;
    expect(after.reminders[1]).toEqual({ kind: 'notes', enabled: false, time: '20:05' });
    expect(after.reminders[0].enabled).toBe(true);
  });

  it('droits : tablette seulement, un parent pour modifier ou essayer', async () => {
    const { call, sent } = setup();
    expect((await call('GET', '/screens/reminders', { from: OTHER })).status).toBe(403);
    const child = await call('PUT', '/screens/reminders', { who: 'lea', body: { reminders: [{ kind: 'notes', enabled: false, time: '20:00' }] } });
    expect(child.status).toBe(403);
    expect(((await child.json()) as { error: string }).error).toBe(SCREENS_PARENTS_ONLY);
    expect((await call('POST', '/screens/reminders/evening-routine/test', { who: 'lea' })).status).toBe(403);
    expect(sent).toEqual([]);
  });

  it('heure et genre vérifiés', async () => {
    const { call } = setup();
    expect((await call('PUT', '/screens/reminders', { body: { reminders: [{ kind: 'notes', enabled: true, time: '25:00' }] } })).status).toBe(400);
    expect((await call('PUT', '/screens/reminders', { body: { reminders: [{ kind: 'coucher', enabled: true, time: '20:00' }] } })).status).toBe(400);
    expect((await call('POST', '/screens/reminders/coucher/test')).status).toBe(404);
  });

  it('Essayer : le bandeau part tout de suite ; 409 s’il n’y a rien à rappeler', async () => {
    const { call, sent } = setup();
    const res = await call('POST', '/screens/reminders/evening-routine/test');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: 'Routine du soir', subtitle: 'Léa : encore 1 étape', screens: 1 });
    expect(sent).toMatchObject([{ kind: 'reminder', reminder: 'evening-routine' }]);
    expect((await call('POST', '/screens/reminders/notes/test')).status).toBe(409);
  });
});
