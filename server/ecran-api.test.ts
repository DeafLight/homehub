// Tests de la route de l'écran de veille de la télé : une télé appairée seulement (jeton de télé), jamais un
// téléphone, la tablette ou un appareil non appairé ; télé retirée : 401.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EcranData } from '../shared/ecran.ts';
import { createAccess, kioskKeyMatcher, UNKNOWN_SCREEN } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createEcranApi } from './ecran-api.ts';
import { createRouter } from './http.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createScreenStore } from './sources/screens.ts';
import { connectedFrom, NOW, testWeather } from './testing.ts';

const TABLET = '192.168.1.50';
const DATA: EcranData = { weather: testWeather, days: [], agenda: [], dinner: ['Soupe'], holiday: null };

async function setup() {
  const clock = () => new Date(NOW);
  const config = createConfigStore(parseConfig({ members: [{ id: 'alex', name: 'Alex', color: '#5b8def', parent: true }], kiosk: { addresses: [TABLET] } }));
  const dir = mkdtempSync(join(tmpdir(), 'homehub-ecran-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const screens = createScreenStore({ path: join(dir, 'screens.json'), clock });
  const access = createAccess({ config, devices, screens, isKey: kioskKeyMatcher(undefined), actorOf: () => null });
  const api = createRouter();
  api.route('/', createEcranApi({ ecran: { data: async () => DATA }, access }));

  const start = screens.startPairing({ system: 'Android 10', app: '0.74.0' });
  const screen = await screens.confirm(start.code, 'Télé du salon');
  const state = await screens.pairing(start.id, 0);
  if (state?.status !== 'paired' || !screen) throw new Error('télé non appairée');
  const { code } = devices.createCode('alex');
  const phone = (await devices.claim(code, 'Téléphone'))!.token;

  const get = (token?: string, from = '192.168.1.60') =>
    api.request('/screen/ecran', { headers: token ? { Authorization: `Bearer ${token}` } : {} }, connectedFrom(from));
  return { get, screens, screenId: screen.id, tv: state.token, phone };
}

describe("API de l'écran de veille de la télé", () => {
  it('la télé appairée lit météo, agenda et menu, sans cache', async () => {
    const { get, tv } = await setup();
    const res = await get(tv);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(DATA);
  });

  it('ni téléphone, ni tablette, ni appareil non appairé, ni télé retirée', async () => {
    const { get, phone, tv, screens, screenId } = await setup();
    expect(await (await get(phone)).json()).toEqual({ error: UNKNOWN_SCREEN });
    expect((await get(undefined, TABLET)).status).toBe(401);
    expect((await get()).status).toBe(401);
    await screens.remove(screenId);
    expect((await get(tv)).status).toBe(401);
  });
});
