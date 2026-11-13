// Tests de l'API du menu de la semaine : droits (un parent seulement, téléphone ou reconnu à la tablette), semaines
// modifiables, et la liste de courses qui suit le menu : lignes ajoutées, recalculées, retirées, jamais celles
// écrites à la main ni celles cochées ; placards, « j'en ai déjà », stock relié, ligne retirée à la main ; paquet
// peut-être entamé « à vérifier au placard » (décisions d'un parent seulement) et arrondi au paquet.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MenuView } from '../shared/menu.ts';
import type { Lists } from '../shared/types.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createListsApi } from './lists-api.ts';
import { createMenuApi, PARENTS_ONLY } from './menu-api.ts';
import { createMenuService } from './services/menu.ts';
import { contentInputSchema, normalizeContent } from './services/recipes.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createListsStore } from './sources/lists.ts';
import { createMenuStore } from './sources/menus.ts';
import { createNotesStore } from './sources/notes.ts';
import { createRecipeStore } from './sources/recipes.ts';
import { createStockStore } from './sources/stock.ts';
import type { Clock } from './sources/types.ts';
import { connectedFrom, fixedClock } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
/** Semaine de l'horloge des tests (lundi 2 novembre 2026). */
const WEEK = '2026-11-02';
const LAIT = '3000000000014';
const LESSIVE = '3000000000052';
const GRUYERE = '3000000000106';

type CallOptions = { from?: string; token?: string; actor?: string; body?: unknown };

async function setup(clock: Clock = fixedClock) {
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-menu-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock: fixedClock });
  const sessions = createActorSessions(fixedClock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const recipes = createRecipeStore({ path: join(dir, 'recipes.json'), photosDir: join(dir, 'recipes'), clock: fixedClock });
  const lists = createListsStore({ path: join(dir, 'lists.json'), clock: fixedClock });
  const stock = createStockStore({ path: join(dir, 'stock.json'), clock: fixedClock });
  const menus = createMenuStore({ path: join(dir, 'menus.json'), clock });
  const notes = createNotesStore({ path: join(dir, 'notes.json'), clock: fixedClock });
  const service = createMenuService({ menus, recipes, stock, lists, clock });
  const api = createRouter();
  api.route('/', createListsApi({ household: createHousehold(config), lists, notes, access, menu: service }));
  api.route('/', createMenuApi({ menus, service, recipes, access, clock }));

  const by = { ownerId: 'alex', via: 'phone' } as const;
  const addRecipe = async (title: string, servings: number, lines: string[]) =>
    recipes.add({ ours: normalizeContent(contentInputSchema.parse({ title, servings, ingredients: lines.map((text) => ({ text })), steps: [] })), source: null }, by);
  const mijote = await addRecipe('Mijoté', 4, ['300 g de lentilles', '3 carottes', '1 oignon', '1 c. à s. d’huile d’olive', 'Sel, poivre', '50 cl de lait']);
  const pates = await addRecipe('Pâtes au thon', 4, ['400 g de pâtes', '100 g d’oignons', 'Persil']);
  const gratin = await addRecipe('Gratin', 4, ['150 g de gruyère râpé', '2 courgettes']);

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
  const view = async (week = WEEK) => (await (await call('GET', `/menu?week=${week}`)).json()) as MenuView;
  const shopping = async () => ((await (await call('GET', '/lists')).json()) as Lists).shopping;
  const later = async () => ((await (await call('GET', '/lists')).json()) as Lists).later ?? [];
  const labels = async () => (await shopping()).map((s) => s.label);
  const add = (recipeId: string, people?: number, day: string | null = null) =>
    call('POST', '/menu/entries', { token: alex, body: { week: WEEK, recipeId, people, day } });
  return { call, phone, tablet, alex, view, shopping, later, labels, add, mijote, pates, gratin, lists, stock, recipes, by };
}

describe('API du menu : droits', () => {
  it('un parent modifie le menu, par son téléphone ou reconnu à la tablette', async () => {
    const { call, tablet, mijote, add } = await setup();
    expect((await add(mijote.id)).status).toBe(201);
    const res = await call('POST', '/menu/entries', { ...tablet('alex'), body: { week: WEEK, recipeId: mijote.id } });
    expect(res.status).toBe(201);
  });

  it('un enfant, un appareil non appairé ou la tablette sans visage ne modifient rien', async () => {
    const { call, phone, tablet, mijote } = await setup();
    const body = { week: WEEK, recipeId: mijote.id };
    const lea = await call('POST', '/menu/entries', { token: await phone('lea'), body });
    expect(lea.status).toBe(403);
    expect(((await lea.json()) as { error: string }).error).toBe(PARENTS_ONLY);
    expect((await call('POST', '/menu/entries', { ...tablet('lea'), body })).status).toBe(403);
    expect((await call('POST', '/menu/entries', { body })).status).toBe(403);
    expect((await call('POST', '/menu/entries', { from: TABLET, body })).status).toBe(403);
    expect((await call('PUT', '/menu/pantry', { token: await phone('lea'), body: { names: [] } })).status).toBe(403);
    expect((await call('PUT', `/menu/links/${LAIT}`, { token: await phone('lea'), body: { link: null } })).status).toBe(403);
  });

  it('tout le monde lit le menu', async () => {
    const { call } = await setup();
    expect((await call('GET', `/menu?week=${WEEK}`)).status).toBe(200);
    expect((await call('GET', '/menu?week=2026-11-03')).status).toBe(400);
  });
});

describe('API du menu : semaines et entrées', () => {
  it('portions de notre version par défaut, jour dans la semaine, recette inconnue refusée', async () => {
    const { add, view, mijote } = await setup();
    await add(mijote.id, undefined, '2026-11-04');
    expect((await view()).entries).toMatchObject([{ recipeId: mijote.id, title: 'Mijoté', people: 4, day: '2026-11-04', servings: 4, missing: false }]);
    expect((await add(mijote.id, 2, '2026-11-10')).status).toBe(400);
    expect((await add('inconnue')).status).toBe(404);
  });

  it('une semaine passée se consulte sans se modifier ; pas plus de 4 semaines devant', async () => {
    const { call, alex, mijote, view } = await setup();
    const past = await call('POST', '/menu/entries', { token: alex, body: { week: '2026-10-26', recipeId: mijote.id } });
    expect(past.status).toBe(400);
    const far = await call('POST', '/menu/entries', { token: alex, body: { week: '2026-12-07', recipeId: mijote.id } });
    expect(far.status).toBe(400);
    expect((await view('2026-10-26')).editable).toBe(false);
  });

  it('personnes et jour modifiés, entrée retirée', async () => {
    const { call, alex, add, view, mijote } = await setup();
    const entry = (await (await add(mijote.id)).json()) as { id: string };
    expect((await call('PUT', `/menu/entries/${entry.id}`, { token: alex, body: { people: 6, day: '2026-11-08' } })).status).toBe(200);
    expect((await view()).entries[0]).toMatchObject({ people: 6, day: '2026-11-08' });
    expect((await call('DELETE', `/menu/entries/${entry.id}`, { token: alex })).status).toBe(204);
    expect((await view()).entries).toEqual([]);
    expect((await call('DELETE', `/menu/entries/${entry.id}`, { token: alex })).status).toBe(404);
  });
});

describe('API du menu : liste de courses', () => {
  it('la liste agrégée rejoint la liste, à côté des produits hors recettes', async () => {
    const { call, alex, add, labels, shopping, mijote, pates } = await setup();
    await call('POST', '/lists/shopping', { token: alex, body: { label: 'Lessive' } });
    await add(mijote.id, 4);
    await add(pates.id, 4);
    expect(await labels()).toEqual(['Lessive', 'Lentille · 300 g', 'Carotte · 3', 'Oignon · 1 + 100 g', 'Lait · 50 cl', 'Pâte · 400 g', 'Persil']);
    const oignon = (await shopping()).find((s) => s.menu?.key === 'oignon');
    expect(oignon?.menu).toMatchObject({ week: WEEK, sources: ['Mijoté', 'Pâtes au thon'], aisle: 'Fruits et légumes' });
  });

  it('recalculée quand le menu change, sans toucher aux lignes cochées ni à celles écrites à la main', async () => {
    const { call, alex, add, labels, shopping, mijote, pates } = await setup();
    await call('POST', '/lists/shopping', { token: alex, body: { label: 'Carottes' } });
    const entry = (await (await add(mijote.id, 4)).json()) as { id: string };
    const pasta = (await (await add(pates.id, 4)).json()) as { id: string };
    // « Carottes » écrite à la main l'emporte : pas de ligne du menu en double.
    expect(await labels()).not.toContain('Carotte · 3');
    const lentille = (await shopping()).find((s) => s.menu?.key === 'lentille')!;
    await call('PUT', `/lists/shopping/${lentille.id}`, { token: alex, body: { done: true } });
    await call('PUT', `/menu/entries/${entry.id}`, { token: alex, body: { people: 6 } });
    const after = await shopping();
    expect(after.find((s) => s.id === lentille.id)).toMatchObject({ label: 'Lentille · 300 g', done: true });
    // Seule la différence revient, sur une nouvelle ligne.
    expect(after.filter((s) => s.menu?.key === 'lentille' && !s.done).map((s) => s.label)).toEqual(['Lentille · 150 g']);
    expect(after.map((s) => s.label)).toContain('Oignon · 1 ½ + 100 g');
    // Recette retirée : ses lignes non cochées partent, la ligne à la main et la ligne cochée restent.
    await call('DELETE', `/menu/entries/${pasta.id}`, { token: alex });
    const left = await labels();
    expect(left).toContain('Carottes');
    expect(left).toContain('Lentille · 300 g');
    expect(left).not.toContain('Persil');
    expect(left).toContain('Oignon · 1 ½');
  });

  it('vider le panier garde le compte de ce qui est acheté', async () => {
    const { call, alex, add, labels, shopping, mijote } = await setup();
    await add(mijote.id, 4);
    for (const item of await shopping()) await call('PUT', `/lists/shopping/${item.id}`, { token: alex, body: { done: true } });
    await call('POST', '/lists/shopping/clear', { token: alex });
    expect(await labels()).toEqual([]);
    await add(mijote.id, 4);
    expect(await labels()).toEqual(['Lentille · 300 g', 'Carotte · 3', 'Oignon · 1', 'Lait · 50 cl']);
  });

  it('placards, « j’en ai déjà » et ligne retirée à la main', async () => {
    const { call, alex, add, labels, shopping, view, mijote } = await setup();
    await add(mijote.id, 4);
    // Placards par défaut : sel, poivre, huile, eau.
    expect(await labels()).not.toContain('Sel');
    expect((await view()).plan.find((l) => l.key === 'huile-d-olive')?.status).toBe('pantry');
    await call('PUT', '/menu/pantry', { token: alex, body: { names: ['Sel', 'Poivre', 'Huile', 'Lentilles'] } });
    expect(await labels()).not.toContain('Lentille · 300 g');
    await call('PUT', '/menu/have', { token: alex, body: { week: WEEK, key: 'carotte', have: true } });
    expect(await labels()).not.toContain('Carotte · 3');
    expect((await view()).plan.find((l) => l.key === 'carotte')?.status).toBe('have');
    const oignon = (await shopping()).find((s) => s.menu?.key === 'oignon')!;
    expect((await call('DELETE', `/lists/shopping/${oignon.id}`, { token: alex })).status).toBe(204);
    expect(await labels()).toEqual(['Lait · 50 cl']);
    expect((await view()).plan.find((l) => l.key === 'oignon')?.status).toBe('have');
    await call('PUT', '/menu/have', { token: alex, body: { week: WEEK, key: 'oignon', have: false } });
    expect(await labels()).toContain('Oignon · 1');
  });

  it('le stock relié retire ce qu’on a, une proposition devinée attend d’être confirmée', async () => {
    const { call, alex, add, labels, view, stock, by, mijote } = await setup();
    await stock.saveManual(LAIT, { name: 'Lait demi-écrémé', brand: null, quantity: '1 L', category: null });
    await stock.saveManual(LESSIVE, { name: 'Lessive liquide', brand: null, quantity: '1,5 L', category: 'Entretien' });
    await stock.add(LAIT, 2, null, by);
    await stock.add(LESSIVE, 1, null, by);
    await add(mijote.id, 4);
    const before = await view();
    // 1 l par brique, 50 cl au plus dans une recette : deviné « s'utilise en plusieurs fois ».
    expect(before.stock).toEqual([
      { code: LAIT, name: 'Lait demi-écrémé', quantity: '1 L', count: 2, link: { key: 'lait', name: 'lait', per: { quantity: 1, unit: 'l' } }, decided: false, partial: true, partialGuessed: true, byCategory: false },
    ]);
    // Proposition pas encore confirmée : rien n'est retiré.
    expect(await labels()).toContain('Lait · 50 cl');
    await call('PUT', `/menu/links/${LAIT}`, { token: alex, body: { link: before.stock[0].link } });
    expect(await labels()).not.toContain('Lait · 50 cl');
    expect((await view()).plan.find((l) => l.key === 'lait')).toMatchObject({ status: 'stock', stock: { enough: true, products: ['2 × Lait demi-écrémé'] } });
    // Oublier la décision : de nouveau proposé, et le lait revient.
    await call('DELETE', `/menu/links/${LAIT}`, { token: alex });
    expect(await labels()).toContain('Lait · 50 cl');
    expect((await view()).stock[0].decided).toBe(false);
    // « Pas un ingrédient » : plus proposé.
    await call('PUT', `/menu/links/${LAIT}`, { token: alex, body: { link: null } });
    expect((await view()).stock).toMatchObject([{ code: LAIT, link: null, decided: true }]);
  });

  it('produit sans code-barres : relié par sa contenance, jamais « peut-être entamé » (c’est ce qui reste)', async () => {
    const { call, alex, add, labels, view, stock, by, mijote } = await setup();
    const { product } = await stock.addLoose({ name: 'Lait de la ferme', brand: null, quantity: '1,5 l', category: 'Frais' }, 1, by);
    await add(mijote.id, 4);
    const proposed = (await view()).stock.find((p) => p.code === product.code)!;
    expect(proposed).toMatchObject({ link: { key: 'lait', per: { quantity: 1.5, unit: 'l' } }, partial: false, partialGuessed: true });
    await call('PUT', `/menu/links/${product.code}`, { token: alex, body: { link: proposed.link } });
    expect(await labels()).not.toContain('Lait · 50 cl');
    expect((await view()).plan.find((l) => l.key === 'lait')).toMatchObject({ status: 'stock', stock: { enough: true } });
  });

  it('un nom sans indice : proposé d’après ses catégories Open Food Facts, jamais relié d’office', async () => {
    const { call, alex, add, labels, view, stock, by, mijote } = await setup();
    const info = { name: 'Brique UHT', brand: 'Laiterie du Val', quantity: '1 L', category: null };
    await stock.saveFromBase(LAIT, { info, image: null, base: 'open-food-facts', categories: ['en:dairies', 'en:milks', 'en:semi-skimmed-milks'] });
    await stock.add(LAIT, 1, null, by);
    await add(mijote.id, 4);
    expect((await view()).stock).toMatchObject([{ code: LAIT, link: { key: 'lait', name: 'lait' }, decided: false, byCategory: true }]);
    expect(await labels()).toContain('Lait · 50 cl');
    // Confirmé : relié comme un autre, plus marqué « d'après sa catégorie ».
    await call('PUT', `/menu/links/${LAIT}`, { token: alex, body: { link: (await view()).stock[0].link } });
    expect(await labels()).not.toContain('Lait · 50 cl');
    expect((await view()).stock).toMatchObject([{ code: LAIT, decided: true, byCategory: false }]);
  });
});

describe('API du menu : paquet peut-être entamé', () => {
  async function withGruyere() {
    const ctx = await setup();
    await ctx.stock.saveManual(GRUYERE, { name: 'Gruyère râpé', brand: null, quantity: '200 g', category: null });
    await ctx.stock.add(GRUYERE, 1, null, ctx.by);
    // Lien enregistré sans « plusieurs fois » (comme avant 0.52) : la valeur devinée s'applique.
    await ctx.call('PUT', `/menu/links/${GRUYERE}`, { token: ctx.alex, body: { link: { key: 'gruyere', name: 'gruyère', per: { quantity: 200, unit: 'g' } } } });
    await ctx.add(ctx.gratin.id, 4);
    const gruyere = async () => (await ctx.view()).plan.find((l) => l.key === 'gruyere')!;
    const line = async () => (await ctx.shopping()).find((s) => s.menu?.key === 'gruyere');
    const decide = (decision: string | null, options: CallOptions = { token: ctx.alex }) => ctx.call('PUT', '/menu/check', { ...options, body: { week: WEEK, key: 'gruyere', decision } });
    return { ...ctx, gruyere, line, decide };
  }

  it('un seul paquet entamé peut-être : à vérifier, dans les courses en attendant, arrondi au paquet', async () => {
    const { view, gruyere, line } = await withGruyere();
    expect((await view()).stock.find((p) => p.code === GRUYERE)).toMatchObject({ partial: true, partialGuessed: true, decided: true });
    expect(await gruyere()).toMatchObject({ status: 'buy', check: 'ask', buy: { masse: 150 }, packs: { count: 1 } });
    expect(await line()).toMatchObject({ label: 'Gruyère · 150 g (1 × 200 g)', done: false, menu: { check: true, packs: { count: 1, per: { quantity: 200, unit: 'g' } } } });
  });

  it('« J’en ai assez », « Il en faut », puis oublier la décision', async () => {
    const { decide, gruyere, line } = await withGruyere();
    expect((await decide('enough')).status).toBe(204);
    expect(await gruyere()).toMatchObject({ status: 'stock', check: 'enough' });
    expect(await line()).toBeUndefined();
    await decide('needed');
    expect(await gruyere()).toMatchObject({ status: 'buy', check: 'needed' });
    const needed = await line();
    expect(needed?.label).toBe('Gruyère · 150 g (1 × 200 g)');
    expect(needed?.menu?.check).toBeUndefined();
    await decide(null);
    expect((await line())?.menu?.check).toBe(true);
  });

  it('décider : un parent seulement, et pas pour une semaine passée', async () => {
    const { call, phone, tablet, alex, decide, gruyere } = await withGruyere();
    const lea = await decide('enough', { token: await phone('lea') });
    expect(lea.status).toBe(403);
    expect(((await lea.json()) as { error: string }).error).toBe(PARENTS_ONLY);
    expect((await decide('enough', tablet('lea'))).status).toBe(403);
    expect((await decide('enough', { from: TABLET })).status).toBe(403);
    expect((await decide('enough', {})).status).toBe(403);
    expect((await decide('enough', tablet('alex'))).status).toBe(204);
    const past = await call('PUT', '/menu/check', { token: alex, body: { week: '2026-10-26', key: 'gruyere', decision: 'enough' } });
    expect(past.status).toBe(400);
    expect((await call('PUT', '/menu/check', { token: alex, body: { week: WEEK, key: 'gruyere', decision: 'peut-être' } })).status).toBe(400);
    expect((await gruyere()).check).toBe('enough');
  });

  it('« s’utilise en une fois » choisi à la main : le paquet compte en entier', async () => {
    const { call, alex, view, gruyere, line } = await withGruyere();
    await call('PUT', `/menu/links/${GRUYERE}`, { token: alex, body: { link: { key: 'gruyere', name: 'gruyère', per: { quantity: 200, unit: 'g' }, partial: false } } });
    expect((await view()).stock.find((p) => p.code === GRUYERE)).toMatchObject({ partial: false, partialGuessed: false });
    expect(await gruyere()).toMatchObject({ status: 'stock', check: null });
    expect(await line()).toBeUndefined();
  });
});


describe('API du menu : frais à acheter plus tard', () => {
  // Horloge réglable : lundi 2 novembre, puis les jours suivants.
  const at = (day: number) => new Date(2026, 10, day, 18, 0);

  it('les frais d’un repas tardif attendent à part, puis rejoignent la liste le jour venu', async () => {
    let now = at(2);
    const { add, labels, later, view, gratin } = await setup(() => new Date(now));
    await add(gratin.id, 4, '2026-11-07');
    // Samedi 7 : courgettes à acheter mercredi 4 ; le gruyère se garde, il est sur la liste tout de suite.
    expect(await labels()).toEqual(['Gruyère · 150 g']);
    expect(await later()).toEqual([{ week: WEEK, key: 'courgette', label: 'Courgette · 2', day: '2026-11-04', aisle: 'Fruits et légumes', sources: ['Gratin'] }]);
    expect((await view()).plan.find((l) => l.key === 'courgette')).toMatchObject({ status: 'later', later: [{ day: '2026-11-04' }] });
    now = at(3);
    expect(await later()).toHaveLength(1);
    now = at(4);
    expect(await labels()).toEqual(['Gruyère · 150 g', 'Courgette · 2']);
    expect(await later()).toEqual([]);
  });

  it('« Acheter maintenant » : un parent, la ligne arrive tout de suite ; « Plus tard » la remet en attente', async () => {
    const { call, phone, add, labels, later, view, gratin, alex } = await setup();
    await add(gratin.id, 4, '2026-11-07');
    const body = { week: WEEK, key: 'courgette', now: true };
    expect((await call('PUT', '/menu/now', { token: await phone('lea'), body })).status).toBe(403);
    expect((await call('PUT', '/menu/now', { token: alex, body })).status).toBe(204);
    expect(await labels()).toContain('Courgette · 2');
    expect(await later()).toEqual([]);
    expect((await view()).plan.find((l) => l.key === 'courgette')).toMatchObject({ status: 'buy', advanced: true });
    expect((await call('PUT', '/menu/now', { token: alex, body: { ...body, now: false } })).status).toBe(204);
    expect(await labels()).not.toContain('Courgette · 2');
    expect(await later()).toHaveLength(1);
    expect((await call('PUT', '/menu/now', { token: alex, body: { ...body, week: '2026-10-26' } })).status).toBe(400);
  });

  it('une ligne cochée n’est pas touchée ; la part tardive arrive sur une nouvelle ligne', async () => {
    let now = at(2);
    const { call, alex, add, shopping, later, mijote } = await setup(() => new Date(now));
    await add(mijote.id, 4, '2026-11-02');
    await add(mijote.id, 4, '2026-11-08');
    const lait = (await shopping()).find((s) => s.menu?.key === 'lait')!;
    expect(lait.label).toBe('Lait · 50 cl');
    expect((await later()).map((l) => [l.key, l.label, l.day])).toEqual([['lait', 'Lait · 50 cl', '2026-11-05']]);
    await call('PUT', `/lists/shopping/${lait.id}`, { token: alex, body: { done: true } });
    now = at(5);
    const after = (await shopping()).filter((s) => s.menu?.key === 'lait');
    expect(after.find((s) => s.id === lait.id)).toMatchObject({ label: 'Lait · 50 cl', done: true });
    expect(after.filter((s) => !s.done).map((s) => s.label)).toEqual(['Lait · 50 cl']);
  });
});

describe('API du menu : dates de péremption', () => {
  it('« À cuisiner d’abord » et stock (DLC) qui finit avant le repas, sans le racheter', async () => {
    const { call, alex, add, labels, view, stock, by, mijote } = await setup();
    await stock.saveManual(GRUYERE, { name: 'Gruyère râpé', brand: null, quantity: '200 g', category: 'Crèmerie' });
    await stock.saveManual(LAIT, { name: 'Lait demi-écrémé', brand: null, quantity: '1 L', category: 'Crèmerie' });
    // Aujourd'hui : lundi 2 novembre. Gruyère jusqu'à mercredi 4 (urgent) ; lait jusqu'à jeudi 5.
    await stock.add(GRUYERE, 1, null, by, { date: '2026-11-04', kind: 'dlc' });
    await stock.add(LAIT, 2, null, by, { date: '2026-11-05', kind: 'dlc' });
    await call('PUT', `/menu/links/${GRUYERE}`, { token: alex, body: { link: { key: 'gruyere', name: 'gruyère', per: { quantity: 200, unit: 'g' }, partial: false } } });
    await call('PUT', `/menu/links/${LAIT}`, { token: alex, body: { link: { key: 'lait', name: 'lait', per: { quantity: 1, unit: 'l' }, partial: false } } });
    const first = await view();
    expect(first.expiry.cookFirst.map((c) => [c.title, c.uses.map((u) => u.key)])).toEqual([
      ['Gratin', ['gruyere']],
      ['Mijoté', ['lait']],
    ]);
    // Mijoté prévu samedi : le lait finit jeudi. Avertissement seulement, la ligne reste couverte par le stock.
    await add(mijote.id, 4, '2026-11-07');
    const after = await view();
    expect(after.expiry.cookFirst.map((c) => c.title)).toEqual(['Gratin']);
    expect(after.expiry.warnings).toEqual([{ key: 'lait', product: 'Lait demi-écrémé', due: '2026-11-05', mealDay: '2026-11-07', recipeId: mijote.id, entryId: after.entries[0].id }]);
    expect(await labels()).not.toContain('Lait · 50 cl');
    expect((await view('2026-10-26')).expiry).toEqual({ cookFirst: [], warnings: [] });
  });
});
