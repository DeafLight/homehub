// Tests du fond de carte servi par HomeHub : présence du fichier, morceaux demandés par `Range`, plage hors du
// fichier, fichier absent, réservé aux téléphones appairés.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createRouter } from './http.ts';
import { createMapApi, parseRange } from './map-api.ts';
import { createDeviceStore } from './sources/devices.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';

function setup(withFile = true) {
  const dir = mkdtempSync(join(tmpdir(), 'homehub-map-'));
  const tiles = join(dir, 'angers.pmtiles');
  if (withFile) writeFileSync(tiles, Buffer.from(Array.from({ length: 100 }, (_, i) => i)));
  const config = createConfigStore(parseConfig({ members: [{ id: 'lea', name: 'Léa', color: '#3fb8a8' }], kiosk: { addresses: [TABLET] } }));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock: () => new Date(NOW) });
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: () => null });
  const api = createRouter();
  api.route('/', createMapApi({ tilesPath: () => tiles, access }));
  const phone = async () => (await devices.claim(devices.createCode('lea').code, 'Téléphone'))!.token;
  const get = (path: string, headers: Record<string, string> = {}, from = '192.168.1.60') => api.request(path, { headers }, connectedFrom(from));
  return { get, phone };
}

describe('parseRange', () => {
  it('lit les trois formes de plage', () => {
    expect(parseRange('bytes=0-15', 100)).toEqual({ start: 0, end: 15 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
  });

  it('refuse une plage illisible ou hors du fichier', () => {
    expect(parseRange('bytes=100-', 100)).toBeNull();
    expect(parseRange('bytes=5-2', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
    expect(parseRange('octets=0-1', 100)).toBeNull();
  });
});

describe('API du fond de carte', () => {
  it('sert le morceau demandé (206), ou tout le fichier', async () => {
    const { get, phone } = setup();
    const auth = { Authorization: `Bearer ${await phone()}` };
    expect(await (await get('/map', auth)).json()).toEqual({ tiles: true });
    const part = await get('/map/tiles.pmtiles', { ...auth, Range: 'bytes=10-13' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 10-13/100');
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([10, 11, 12, 13]);
    const all = await get('/map/tiles.pmtiles', auth);
    expect(all.status).toBe(200);
    expect((await all.arrayBuffer()).byteLength).toBe(100);
    expect((await get('/map/tiles.pmtiles', { ...auth, Range: 'bytes=200-' })).status).toBe(416);
  });

  it('sans fichier : la carte le sait, le fichier est introuvable', async () => {
    const { get, phone } = setup(false);
    const auth = { Authorization: `Bearer ${await phone()}` };
    expect(await (await get('/map', auth)).json()).toEqual({ tiles: false });
    expect((await get('/map/tiles.pmtiles', auth)).status).toBe(404);
  });

  it('ni la tablette, ni un appareil non appairé', async () => {
    const { get } = setup();
    expect((await get('/map', {}, TABLET)).status).toBe(403);
    expect((await get('/map/tiles.pmtiles')).status).toBe(403);
  });
});
