import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Lists, Product, ProductRecheck, ScanLookup, StockData, StockMovement, StockMovementResult } from '../shared/types.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createListsStore } from './sources/lists.ts';
import type { BaseProduct, ProductBase } from './sources/open-food-facts.ts';
import { createStockStore } from './sources/stock.ts';
import { createStockApi } from './stock-api.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const COMPOTE = '3560070446117';
const LESSIVE = '3017620422003';
const MYSTERE = '4006381333931';

function setup(catalog: Record<string, BaseProduct | 'error'> = {}) {
  let now = new Date(NOW);
  const clock = () => new Date(now);
  const config = createConfigStore(parseConfig({ members: [{ id: 'alex', name: 'Alex', color: '#5b8def', parent: true }], kiosk: { addresses: [TABLET] } }));
  const dir = mkdtempSync(join(tmpdir(), 'homehub-stock-'));
  const lists = createListsStore({ path: join(dir, 'lists.json'), clock });
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const stock = createStockStore({ path: join(dir, 'stock.json'), clock });
  const asked: string[] = [];
  const productBase: ProductBase = {
    async find(code) {
      asked.push(code);
      const found = catalog[code];
      if (found === 'error') throw new Error('injoignable');
      return found ?? null;
    },
  };
  const api = createStockApi({ stock, productBase, lists, access, clock, logger: { error() {} } });
  const call = async <T>(method: string, path: string, body?: unknown, from = TABLET, extra: Record<string, string> = {}) => {
    const res = await api.request(
      path,
      { method, headers: { 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) },
      connectedFrom(from),
    );
    return { status: res.status, json: (res.status === 204 ? null : await res.json()) as T };
  };
  const shopping = async () => (await lists.lists() as Lists).shopping.map((s) => s.label);
  const later = (days: number) => (now = new Date(now.getTime() + days * 86_400_000));
  const laterMinutes = (minutes: number) => (now = new Date(now.getTime() + minutes * 60_000));
  const phone = async () => (await devices.claim(devices.createCode('alex').code, 'Téléphone'))!.token;
  return { call, asked, shopping, sessions, later, laterMinutes, phone };
}

const compote: BaseProduct = { info: { name: 'Purée de pomme', brand: 'Carrefour Kids', quantity: '4 x 90 g' }, image: 'https://img/1.jpg', base: 'open-food-facts' };

describe('API du stock', () => {
  it('note l’heure et qui a scanné : personne reconnue devant la tablette, sinon anonyme', async () => {
    const { call, sessions, laterMinutes } = setup({ [COMPOTE]: compote });
    await call('GET', `/stock/scan/${COMPOTE}`);
    const { token } = sessions.open('alex', 10);
    const added = await call<StockMovementResult>('POST', '/stock/in', { code: COMPOTE }, TABLET, { 'X-Actor-Session': token });
    expect(added.json).toMatchObject({ at: NOW.toISOString(), by: { ownerId: 'alex', via: 'tablet' } });

    laterMinutes(5);
    const out = await call<StockMovementResult>('POST', '/stock/out', { code: COMPOTE });
    expect(out.json).toMatchObject({ by: { ownerId: null, via: 'tablet' } });
    const outAt = out.json.at;
    expect(Date.parse(outAt) - NOW.getTime()).toBe(5 * 60_000);

    const data = await call<StockData>('GET', '/stock');
    expect(data.json.items[0]).toMatchObject({
      lastIn: { at: NOW.toISOString(), by: { ownerId: 'alex' } },
      lastOut: { at: outAt, by: { ownerId: null } },
    });

    // Historique du produit, du plus récent au plus ancien ; un mouvement annulé reste, marqué, et n'est plus « dernier ».
    await call('POST', '/stock/undo', { movementId: out.json.movementId });
    const history = await call<StockMovement[]>('GET', `/stock/products/${COMPOTE}/movements`);
    expect(history.json.map((m) => [m.kind, m.by.ownerId, m.undone])).toEqual([
      ['out', null, true],
      ['in', 'alex', false],
    ]);
    expect((await call<StockData>('GET', '/stock')).json.items[0].lastOut).toBeNull();
  });

  it('reconnaît un produit dans la base une seule fois, puis le range et le sort', async () => {
    const { call, asked, shopping } = setup({ [COMPOTE]: compote });
    const scan = await call<ScanLookup>('GET', `/stock/scan/${COMPOTE}`);
    expect(scan.json).toMatchObject({ kind: 'product', quantity: 0, product: { current: { name: 'Purée de pomme', brand: 'Carrefour Kids', source: 'base' } } });
    await call('GET', `/stock/scan/${COMPOTE}`);
    expect(asked).toEqual([COMPOTE]); // copie locale : la base n'est interrogée qu'une fois

    const added = await call<StockMovementResult>('POST', '/stock/in', { code: COMPOTE, count: 2 });
    expect(added.status).toBe(201);
    expect(added.json.quantity).toBe(2);

    const first = await call<StockMovementResult>('POST', '/stock/out', { code: COMPOTE });
    expect(first.json).toMatchObject({ quantity: 1, shopping: 'none', forgotten: false });
    const last = await call<StockMovementResult>('POST', '/stock/out', { code: COMPOTE });
    expect(last.json).toMatchObject({ quantity: 0, shopping: 'propose', shoppingLabel: 'Purée de pomme' });
    expect(await shopping()).toEqual([]);

    // « Oui, et toujours » : sur la liste, et d'office la prochaine fois.
    await call('POST', '/stock/shopping', { code: COMPOTE, always: true });
    expect(await shopping()).toEqual(['Purée de pomme']);
    const data = await call<StockData>('GET', '/stock');
    expect(data.json.items[0].product.autoShop).toBe(true);
  });

  it('ajoute d’office à la liste quand c’est réglé, et l’annulation retire l’article', async () => {
    const { call, shopping } = setup({ [COMPOTE]: compote });
    await call('GET', `/stock/scan/${COMPOTE}`);
    await call('PUT', '/stock/settings', { autoShop: true });
    await call('POST', '/stock/in', { code: COMPOTE });
    const out = await call<StockMovementResult>('POST', '/stock/out', { code: COMPOTE });
    expect(out.json.shopping).toBe('added');
    expect(await shopping()).toEqual(['Purée de pomme']);

    const undo = await call<{ quantity: number }>('POST', '/stock/undo', { movementId: out.json.movementId });
    expect(undo.json.quantity).toBe(1);
    expect(await shopping()).toEqual([]);
    // Déjà annulé : refusé.
    expect((await call('POST', '/stock/undo', { movementId: out.json.movementId })).status).toBe(409);
  });

  it('n’annule que le dernier mouvement d’un produit', async () => {
    const { call } = setup({ [COMPOTE]: compote });
    await call('GET', `/stock/scan/${COMPOTE}`);
    const first = await call<StockMovementResult>('POST', '/stock/in', { code: COMPOTE });
    const second = await call<StockMovementResult>('POST', '/stock/in', { code: COMPOTE });
    expect((await call('POST', '/stock/undo', { movementId: first.json.movementId })).status).toBe(409);
    expect((await call<{ quantity: number }>('POST', '/stock/undo', { movementId: second.json.movementId })).json.quantity).toBe(1);
    expect((await call<{ quantity: number }>('POST', '/stock/undo', { movementId: first.json.movementId })).json.quantity).toBe(0);
  });

  it('inconnu de la base : saisi à la main, puis rangé', async () => {
    const { call } = setup();
    const scan = await call<ScanLookup>('GET', `/stock/scan/${MYSTERE}`);
    expect(scan.json).toEqual({ kind: 'unknown', code: MYSTERE, suggestion: null, baseError: false });
    expect((await call('POST', '/stock/in', { code: MYSTERE })).status).toBe(404);

    const saved = await call<Product>('PUT', `/stock/products/${MYSTERE}`, { name: 'Sauce maison', brand: '', quantity: '500 g', category: 'Épicerie' });
    expect(saved.json.current).toMatchObject({ name: 'Sauce maison', brand: null, quantity: '500 g', category: 'Épicerie', source: 'manual' });
    expect((await call<StockMovementResult>('POST', '/stock/in', { code: MYSTERE })).json.quantity).toBe(1);
  });

  it('base injoignable : le produit se saisit à la main', async () => {
    const { call } = setup({ [MYSTERE]: 'error' });
    expect((await call<ScanLookup>('GET', `/stock/scan/${MYSTERE}`)).json).toMatchObject({ kind: 'unknown', baseError: true });
  });

  it('sortie d’un produit jamais entré : acceptée, et ce qui reste entre au stock', async () => {
    const { call } = setup({ [COMPOTE]: compote });
    await call('GET', `/stock/scan/${COMPOTE}`);
    const out = await call<StockMovementResult>('POST', '/stock/out', { code: COMPOTE, remaining: 3 });
    expect(out.json).toMatchObject({ forgotten: true, quantity: 3, shopping: 'none' });
    const gone = await call<StockMovementResult>('POST', '/stock/out', { code: COMPOTE, remaining: 0, all: true });
    expect(gone.json).toMatchObject({ forgotten: false, quantity: 0, shopping: 'propose' });
  });

  it('recharge transvasée : l’emballage sort, le produit reste dans le contenant, retenu pour la suite', async () => {
    const { call, shopping } = setup({ [LESSIVE]: { info: { name: 'Lessive liquide', brand: 'X', quantity: '1,5 L' }, image: null, base: 'open-products-facts' } });
    await call('GET', `/stock/scan/${LESSIVE}`);
    const bidon = await call<{ id: string; code: string }>('POST', '/stock/containers', { name: 'Bidon de lessive' });
    expect(bidon.json.code).toMatch(/^29/u);
    await call('POST', '/stock/in', { code: LESSIVE });
    const out = await call<StockMovementResult>('POST', '/stock/out', { code: LESSIVE, refill: bidon.json.id });
    expect(out.json).toMatchObject({ quantity: 0, shopping: 'none', container: { name: 'Bidon de lessive', full: true, productName: 'Lessive liquide' } });
    expect(out.json.product?.refill).toBe(bidon.json.id);

    // L'étiquette du bidon se scanne comme un produit.
    expect((await call<ScanLookup>('GET', `/stock/scan/${bidon.json.code}`)).json).toMatchObject({ kind: 'container', container: { full: true } });
    const empty = await call<StockMovementResult>('POST', `/stock/containers/${bidon.json.id}/empty`);
    expect(empty.json).toMatchObject({ shopping: 'propose', shoppingLabel: 'Lessive liquide', container: { full: false } });
    expect(await shopping()).toEqual([]);
  });

  it('« Revérifier » montre la base ; une relecture qui contredit notre correction est signalée sans rien changer', async () => {
    const catalog: Record<string, BaseProduct> = { [COMPOTE]: compote };
    const { call, later } = setup(catalog);
    await call('GET', `/stock/scan/${COMPOTE}`);
    await call('PUT', `/stock/products/${COMPOTE}`, { name: 'Compote pomme', brand: 'Carrefour Kids', quantity: '4 x 90 g' });

    const recheck = await call<ProductRecheck>('POST', `/stock/products/${COMPOTE}/recheck`);
    expect(recheck.json).toMatchObject({ differs: true, current: { name: 'Compote pomme' }, base: { name: 'Purée de pomme' } });

    // Six mois plus tard, la base a changé la contenance : notre version reste, le conflit est signalé.
    catalog[COMPOTE] = { ...compote, info: { ...compote.info, quantity: '4 x 85 g' } };
    later(200);
    const scan = await call<ScanLookup & { kind: 'product' }>('GET', `/stock/scan/${COMPOTE}`);
    expect(scan.json.product.current.name).toBe('Compote pomme');
    expect(scan.json.product.conflict).toMatchObject({ quantity: '4 x 85 g' });

    const resolved = await call<Product>('POST', `/stock/products/${COMPOTE}/conflict`, { take: 'base' });
    expect(resolved.json).toMatchObject({ conflict: null, versionCount: 3, current: { quantity: '4 x 85 g', source: 'base' } });
  });

  it('écriture : la tablette sans personne reconnue, pas un autre appareil', async () => {
    const { call } = setup({ [COMPOTE]: compote });
    await call('GET', `/stock/scan/${COMPOTE}`);
    expect((await call('POST', '/stock/in', { code: COMPOTE }, OTHER)).status).toBe(403);
    expect((await call('POST', '/stock/in', { code: COMPOTE })).status).toBe(201);
    expect((await call('POST', '/stock/in', { code: '123' })).status).toBe(400);
  });

  it('base de produits (appel sortant) : la tablette ou un téléphone appairé, pas un autre appareil', async () => {
    const { call, asked, phone } = setup({ [COMPOTE]: compote });
    expect((await call('GET', `/stock/scan/${COMPOTE}`, undefined, OTHER)).status).toBe(403);
    // L'adresse de la tablette annoncée par un en-tête, hors proxy de confiance, ne compte pas.
    expect((await call('GET', `/stock/scan/${COMPOTE}`, undefined, OTHER, { 'X-Real-IP': TABLET })).status).toBe(403);
    expect(asked).toEqual([]);
    expect((await call('GET', `/stock/scan/${COMPOTE}`)).status).toBe(200);
    expect(asked).toEqual([COMPOTE]);

    expect((await call('POST', `/stock/products/${COMPOTE}/recheck`, undefined, OTHER)).status).toBe(403);
    expect((await call('POST', `/stock/products/${COMPOTE}/recheck`, undefined, OTHER, { 'X-Real-IP': '127.0.0.1' })).status).toBe(403);
    expect(asked).toEqual([COMPOTE]);
    const token = await phone();
    const recheck = await call('POST', `/stock/products/${COMPOTE}/recheck`, undefined, OTHER, { Authorization: `Bearer ${token}` });
    expect(recheck.status).toBe(200);
    expect(asked).toEqual([COMPOTE, COMPOTE]);
    expect((await call('POST', `/stock/products/${COMPOTE}/recheck`, undefined, OTHER, { Authorization: 'Bearer retire' })).status).toBe(401);
  });
});
