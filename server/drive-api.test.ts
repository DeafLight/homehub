// Tests de l'API du drive : droits (réglages et choix par un parent, téléphone ou reconnu à la tablette ; ni enfant,
// ni appareil non appairé, ni tablette sans visage), lecture d'une fiche une fois à la demande (refus du site : rien
// n'est contourné, la saisie reste possible), EAN repris du stock, produit retenu, secours, retrait ; pièces par
// paquet et panier en cours (droits de la liste de courses, paquets calculés par le serveur, lignes des articles
// partis de la liste ignorées, nouveau panier).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DriveChoice, DriveView } from '../shared/drive.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createDriveApi, DRIVE_PARENTS_ONLY, NO_ENSEIGNE, REFUSED_PRODUCT } from './drive-api.ts';
import { createRouter } from './http.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createDriveReader } from './sources/drive-page.ts';
import { createDriveStore } from './sources/drive.ts';
import { createListsStore } from './sources/lists.ts';
import { createActorSessions } from './sources/faces.ts';
import { createMenuStore } from './sources/menus.ts';
import { createStockStore } from './sources/stock.ts';
import { PageError, type PageFetcher } from './sources/web-page.ts';
import { connectedFrom, fixedClock } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const FICHE = 'https://www.coursesu.com/p/lardons-fumes-exemple/9990001.html';
const AUTRE = 'https://www.coursesu.com/p/lardons-nature-exemple/9990002.html';
const EAN = '2000000000015';
const html = readFileSync(new URL('./sources/fixtures/drive/fiche-produit.html', import.meta.url), 'utf8');

type CallOptions = { from?: string; token?: string; actor?: string; body?: unknown };

async function setup({ refuse = false } = {}) {
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-drive-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock: fixedClock });
  const sessions = createActorSessions(fixedClock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const stock = createStockStore({ path: join(dir, 'stock.json'), clock: fixedClock });
  const menus = createMenuStore({ path: join(dir, 'menus.json'), clock: fixedClock });
  const lists = createListsStore({ path: join(dir, 'lists.json'), clock: fixedClock });
  const fetched: string[] = [];
  const fetchPage: PageFetcher = async (url) => {
    fetched.push(url);
    if (refuse) throw new PageError('refused', 'Le site a refusé la lecture (HTTP 403)');
    return { url, contentType: 'text/html', body: new TextEncoder().encode(html) };
  };
  const api = createRouter();
  api.route('/', createDriveApi({ drive: createDriveStore({ path: join(dir, 'drive.json'), clock: fixedClock }), reader: createDriveReader({ fetchPage }), stock, menus, lists, access, clock: fixedClock }));

  const phone = async (ownerId: string) => {
    const { code } = devices.createCode(ownerId);
    return (await devices.claim(code, `Téléphone de ${ownerId}`))!.token;
  };
  const tablet = (ownerId: string) => ({ from: TABLET, actor: sessions.open(ownerId, 10).token });
  const call = (method: string, path: string, { from = OTHER, token, actor, body }: CallOptions = {}) =>
    api.request(
      path,
      {
        method,
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...(actor && { 'X-Actor-Session': actor }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      connectedFrom(from),
    );
  const alex = await phone('alex');
  const enable = () => call('PUT', '/drive/settings', { token: alex, body: { enseigne: 'coursesu', store: { name: 'Super U Exemple', url: null } } });
  const choose = (body: unknown, options: CallOptions = { token: alex }) => call('PUT', '/drive/choices', { ...options, body });
  const lardons = (product: Record<string, unknown> = {}, role?: string) => ({ key: 'lardon', label: 'Lardons', role, product: { url: FICHE, name: 'Lardons fumés, 2x100g', packText: '2x100g', ...product } });
  const view = async () => (await (await call('GET', '/drive')).json()) as DriveView;
  return { call, phone, tablet, alex, enable, choose, lardons, view, stock, menus, lists, fetched };
}

describe('API du drive : droits', () => {
  it('lecture ouverte ; réglages par un parent, téléphone ou reconnu à la tablette', async () => {
    const { call, tablet, enable, view } = await setup();
    expect(await view()).toEqual({ settings: { enseigne: null, store: null }, choices: [], basket: null });
    expect((await enable()).status).toBe(200);
    const res = await call('PUT', '/drive/settings', { ...tablet('alex'), body: { enseigne: 'coursesu', store: { name: 'Hyper U Exemple', url: 'https://www.coursesu.com/magasin/exemple?ref=1' } } });
    expect(((await res.json()) as DriveView).settings).toEqual({ enseigne: 'coursesu', store: { name: 'Hyper U Exemple', url: 'https://www.coursesu.com/magasin/exemple' } });
  });

  it('un enfant, un appareil non appairé ou la tablette sans visage ne règlent ni ne choisissent rien', async () => {
    const { call, phone, tablet, enable, choose, lardons } = await setup();
    const body = { enseigne: 'coursesu', store: null };
    const lea = await call('PUT', '/drive/settings', { token: await phone('lea'), body });
    expect(lea.status).toBe(403);
    expect(((await lea.json()) as { error: string }).error).toBe(DRIVE_PARENTS_ONLY);
    expect((await call('PUT', '/drive/settings', { body })).status).toBe(403);
    expect((await call('PUT', '/drive/settings', { from: TABLET, body })).status).toBe(403);
    await enable();
    expect((await choose(lardons(), { token: await phone('lea') })).status).toBe(403);
    expect((await choose(lardons(), tablet('lea'))).status).toBe(403);
    expect((await choose(lardons(), {})).status).toBe(403);
    expect((await call('POST', '/drive/read', { from: TABLET, body: { url: FICHE } })).status).toBe(403);
    expect((await call('DELETE', '/drive/choices?key=lardon', { token: await phone('lea') })).status).toBe(403);
  });

  it('lien du magasin hors du site de l’enseigne refusé', async () => {
    const { call, alex } = await setup();
    const res = await call('PUT', '/drive/settings', { token: alex, body: { enseigne: 'coursesu', store: { name: 'X', url: 'https://ailleurs.exemple.test/magasin' } } });
    expect(res.status).toBe(400);
  });
});

describe('API du drive : fiche et choix', () => {
  it('sans enseigne choisie : rien à lire ni à retenir', async () => {
    const { call, alex, choose, lardons, fetched } = await setup();
    const res = await call('POST', '/drive/read', { token: alex, body: { url: FICHE } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(NO_ENSEIGNE);
    expect((await choose(lardons())).status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it('lit la fiche une fois à la demande ; EAN retrouvé au stock', async () => {
    const { call, alex, enable, stock, fetched } = await setup();
    await enable();
    await stock.saveManual(EAN, { name: 'Lardons fumés', brand: 'Ferme des Coteaux', quantity: '2 x 100 g', category: null });
    const res = await call('POST', '/drive/read', { token: alex, body: { url: `Regarde : ${FICHE}?pk=2` } });
    expect(await res.json()).toEqual({
      read: true,
      product: { enseigne: 'coursesu', id: '9990001', url: FICHE, name: 'Lardons fumés Ferme des Coteaux, 2x100g', brand: 'Ferme des Coteaux', packText: '2x100g', ean: EAN },
      stock: { ean: EAN, name: 'Lardons fumés', brand: 'Ferme des Coteaux', quantity: '2 x 100 g' },
    });
    expect(fetched).toEqual([FICHE]);
  });

  it('jamais de lecture hors d’une fiche produit (recherche, autre site)', async () => {
    const { call, alex, enable, fetched } = await setup();
    await enable();
    expect((await call('POST', '/drive/read', { token: alex, body: { url: 'https://www.coursesu.com/recherche?q=lardons' } })).status).toBe(400);
    expect((await call('POST', '/drive/read', { token: alex, body: { url: 'https://cuisine.exemple.test/p/x/1.html' } })).status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it('site qui refuse : rien n’est contourné, on garde l’identifiant et on saisit le reste', async () => {
    const { call, alex, enable, fetched } = await setup({ refuse: true });
    await enable();
    const res = await call('POST', '/drive/read', { token: alex, body: { url: FICHE } });
    expect(await res.json()).toEqual({
      read: false,
      refused: true,
      reason: REFUSED_PRODUCT,
      product: { enseigne: 'coursesu', id: '9990001', url: FICHE, name: '', brand: null, packText: null, ean: null },
      stock: null,
    });
    expect(fetched).toEqual([FICHE]);
  });

  it('retient un produit (contenance lue), un secours, puis retire le retenu sans prendre le secours', async () => {
    const { call, alex, enable, choose, lardons, view } = await setup();
    await enable();
    const res = await choose(lardons({ ean: EAN, source: 'page' }));
    const choice = (await res.json()) as DriveChoice;
    expect(choice).toMatchObject({ key: 'lardon', enseigne: 'coursesu', label: 'Lardons', fallback: [], updatedBy: { ownerId: 'alex', via: 'phone' } });
    expect(choice.preferred).toMatchObject({ id: '9990001', url: FICHE, pack: { quantity: 200, unit: 'g' }, ean: EAN, source: 'page' });
    await choose(lardons({ url: AUTRE, name: 'Lardons nature', packText: null }, 'fallback'));
    let [stored] = (await view()).choices;
    expect(stored.preferred?.id).toBe('9990001');
    expect(stored.fallback).toMatchObject([{ id: '9990002', pack: null }]);
    expect((await call('DELETE', '/drive/choices?key=lardon&id=9990001', { token: alex })).status).toBe(204);
    [stored] = (await view()).choices;
    expect(stored.preferred).toBeNull();
    expect(stored.fallback.map((p) => p.id)).toEqual(['9990002']);
    expect((await call('DELETE', '/drive/choices?key=lardon', { token: alex })).status).toBe(204);
    expect((await view()).choices).toEqual([]);
    expect((await call('DELETE', '/drive/choices?key=lardon', { token: alex })).status).toBe(404);
  });

  it('refuse un lien qui n’est pas une fiche, un nom vide, un EAN illisible', async () => {
    const { enable, choose, lardons } = await setup();
    await enable();
    expect((await choose(lardons({ url: 'https://www.coursesu.com/' }))).status).toBe(400);
    expect((await choose(lardons({ name: ' ' }))).status).toBe(400);
    expect((await choose(lardons({ ean: '12ab' }))).status).toBe(400);
  });

  it('produits du stock qui ressemblent à l’article : reliés dans le menu ou de même nom', async () => {
    const { call, enable, stock, menus } = await setup();
    await enable();
    await stock.saveManual(EAN, { name: 'Lardons fumés', brand: null, quantity: '200 g', category: null });
    await stock.saveManual('2000000000022', { name: 'Allumettes de porc', brand: null, quantity: '150 g', category: null });
    await stock.saveManual('2000000000039', { name: 'Lessive liquide', brand: null, quantity: '1,5 L', category: null });
    await menus.setLink('2000000000022', { key: 'lardon', name: 'lardon', per: { quantity: 150, unit: 'g' } });
    const hints = async (key: string) => ((await (await call('GET', `/drive/stock?key=${encodeURIComponent(key)}`)).json()) as { hints: { ean: string }[] }).hints.map((h) => h.ean);
    expect((await hints('lardon')).sort()).toEqual([EAN, '2000000000022']);
    expect(await hints('lessive')).toEqual(['2000000000039']);
    expect((await call('GET', '/drive/stock')).status).toBe(400);
  });
});

describe('API du drive : remplir le panier', () => {
  const by = { ownerId: 'alex', via: 'phone' } as const;
  const OIGNON = 'https://www.coursesu.com/p/oignons-jaunes-exemple/9990010.html';

  /** Liste : « Lardons · 350 g » et « Oignons · 5 » venus du menu, « Lessive » ajoutée à la main. */
  async function withList() {
    const ctx = await setup();
    const { lists } = ctx;
    const mark = (key: string, quantities: Record<string, number>) => ({ week: '2026-03-09', key, quantities, toTaste: false, aisle: null, sources: ['Recette'] });
    await lists.syncMenu(() => ({ add: [{ label: 'Lardons · 350 g', menu: mark('lardon', { masse: 350 }) }, { label: 'Oignons · 5', menu: mark('oignon', { piece: 5 }) }], update: [], remove: [] }), by);
    await lists.addShopping('Lessive', by);
    const items = (await lists.lists()).shopping;
    const id = (label: string) => items.find((i) => i.label.startsWith(label))!.id;
    await ctx.enable();
    return { ...ctx, id };
  }

  it('cocher un article : produit retenu et paquets calculés par le serveur ; décocher le retire', async () => {
    const { call, alex, choose, lardons, id } = await withList();
    await choose(lardons());
    let res = await call('PUT', `/drive/basket/${id('Lardons')}`, { token: alex, body: { in: true, count: 99 } });
    expect(res.status).toBe(200);
    let { basket } = (await res.json()) as DriveView;
    expect(basket).toMatchObject({ enseigne: 'coursesu', startedBy: { ownerId: 'alex', via: 'phone' } });
    expect(basket?.lines).toMatchObject([{ itemId: id('Lardons'), key: 'lardon', label: 'Lardons', product: { id: '9990001', url: FICHE }, count: 2, per: { quantity: 200, unit: 'g' } }]);
    res = await call('PUT', `/drive/basket/${id('Lessive')}`, { token: alex, body: { in: true } });
    expect(((await res.json()) as DriveView).basket?.lines.find((l) => l.key === 'lessive')).toMatchObject({ product: null, count: 1, per: null });
    res = await call('PUT', `/drive/basket/${id('Lardons')}`, { token: alex, body: { in: false } });
    ({ basket } = (await res.json()) as DriveView);
    expect(basket?.lines.map((l) => l.key)).toEqual(['lessive']);
  });

  it('pièces par paquet : « 5 oignons » contre un filet de 1 kg de 3 pièces → 2 paquets', async () => {
    const { call, alex, choose, id } = await withList();
    await choose({ key: 'oignon', label: 'Oignons', product: { url: OIGNON, name: 'Oignons jaunes, filet 1kg', packText: '1 kg' } });
    let res = await call('PUT', `/drive/basket/${id('Oignons')}`, { token: alex, body: { in: true } });
    expect(((await res.json()) as DriveView).basket?.lines[0]).toMatchObject({ count: 1, per: { quantity: 1, unit: 'kg' } });
    res = await call('PUT', '/drive/pieces', { token: alex, body: { key: 'oignon', id: '9990010', pieces: 3 } });
    expect(((await res.json()) as DriveChoice).preferred?.pieces).toBe(3);
    res = await call('PUT', `/drive/basket/${id('Oignons')}`, { token: alex, body: { in: true } });
    expect(((await res.json()) as DriveView).basket?.lines).toMatchObject([{ key: 'oignon', count: 2 }]);
    expect((await call('PUT', '/drive/pieces', { token: alex, body: { key: 'oignon', id: '1', pieces: 3 } })).status).toBe(404);
    expect((await call('PUT', '/drive/pieces', { token: alex, body: { key: 'oignon', id: '9990010', pieces: 0 } })).status).toBe(400);
  });

  it('article parti de la liste : sa ligne n’est plus montrée ; nouveau panier : plus rien', async () => {
    const { call, alex, lists, view, id } = await withList();
    await call('PUT', `/drive/basket/${id('Lessive')}`, { token: alex, body: { in: true } });
    await call('PUT', `/drive/basket/${id('Lardons')}`, { token: alex, body: { in: true } });
    await lists.removeShopping(id('Lessive'));
    expect((await view()).basket?.lines.map((l) => l.key)).toEqual(['lardon']);
    const res = await call('DELETE', '/drive/basket', { token: alex });
    expect(((await res.json()) as DriveView).basket).toBeNull();
  });

  it('article inconnu ou déjà acheté refusé ; sans enseigne, rien à cocher', async () => {
    const { call, alex, lists, id } = await withList();
    expect((await call('PUT', '/drive/basket/inconnu', { token: alex, body: { in: true } })).status).toBe(404);
    await lists.setShoppingDone(id('Lessive'), true, by);
    expect((await call('PUT', `/drive/basket/${id('Lessive')}`, { token: alex, body: { in: true } })).status).toBe(409);
    await call('PUT', '/drive/settings', { token: alex, body: { enseigne: null, store: null } });
    expect((await call('PUT', `/drive/basket/${id('Lardons')}`, { token: alex, body: { in: true } })).status).toBe(400);
  });

  it('droits : un parent (téléphone ou reconnu à la tablette) ; ni enfant, ni appareil non appairé, ni tablette sans visage', async () => {
    const { call, phone, tablet, id } = await withList();
    const path = `/drive/basket/${id('Lessive')}`;
    expect((await call('PUT', path, { ...tablet('alex'), body: { in: true } })).status).toBe(200);
    expect((await call('PUT', path, { token: await phone('lea'), body: { in: false } })).status).toBe(403);
    expect((await call('PUT', path, { ...tablet('lea'), body: { in: false } })).status).toBe(403);
    expect((await call('PUT', path, { body: { in: false } })).status).toBe(403);
    expect((await call('PUT', path, { from: TABLET, body: { in: false } })).status).toBe(403);
    expect((await call('DELETE', '/drive/basket', { token: await phone('lea') })).status).toBe(403);
    expect((await call('PUT', '/drive/pieces', { token: await phone('lea'), body: { key: 'oignon', id: '1', pieces: 3 } })).status).toBe(403);
  });
});
