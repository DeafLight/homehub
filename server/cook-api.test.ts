// Tests de l'API « J'ai cuisiné » : droits (toute la famille, comme le stock), proposition recalculée par le serveur,
// décompte (sorties de N paquets d'un coup, paquet entamé, mouvements groupés et leur raison), repas noté cuisiné et
// calcul des courses qui l'exclut, « Ne rien retirer », coches « j'en ai déjà » et « j'en ai assez », liste de courses
// pour les produits épuisés, annulation (et ce qui a bougé depuis), fenêtre de la semaine plus deux jours, hors menu,
// recette retirée du carnet, réponses refusées et rappel des repas passés.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CookProposal, CookResult, CookUndo } from '../shared/cook.ts';
import type { MenuView, StockLink } from '../shared/menu.ts';
import type { Lists, StockData, StockMovement } from '../shared/types.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createCookApi } from './cook-api.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createListsApi } from './lists-api.ts';
import { createMenuApi } from './menu-api.ts';
import { createCookService } from './services/cook.ts';
import { createMenuService } from './services/menu.ts';
import { contentInputSchema, normalizeContent } from './services/recipes.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createListsStore } from './sources/lists.ts';
import { createMenuStore } from './sources/menus.ts';
import { createNotesStore } from './sources/notes.ts';
import { createRecipeStore } from './sources/recipes.ts';
import { createStockStore } from './sources/stock.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
/** Semaine de l'horloge des tests (lundi 2 novembre 2026, 18 h). */
const WEEK = '2026-11-02';
const PENNE = '3000000000201';
const THON = '3000000000202';
const CREME = '3000000000203';
const GRUYERE = '3000000000204';

type CallOptions = { from?: string; token?: string; body?: unknown };

async function setup() {
  let now = new Date(NOW);
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
  const dir = mkdtempSync(join(tmpdir(), 'homehub-cook-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const recipes = createRecipeStore({ path: join(dir, 'recipes.json'), photosDir: join(dir, 'recipes'), clock });
  const lists = createListsStore({ path: join(dir, 'lists.json'), clock });
  const stock = createStockStore({ path: join(dir, 'stock.json'), clock });
  const menus = createMenuStore({ path: join(dir, 'menus.json'), clock });
  const notes = createNotesStore({ path: join(dir, 'notes.json'), clock });
  const menu = createMenuService({ menus, recipes, stock, lists, clock });
  const cook = createCookService({ menus, recipes, stock, lists, menu, clock });
  const api = createRouter();
  api.route('/', createListsApi({ household: createHousehold(config), lists, notes, access, menu }));
  api.route('/', createMenuApi({ menus, service: menu, recipes, access, clock }));
  api.route('/', createCookApi({ service: cook, access }));

  const by = { ownerId: 'alex', via: 'phone' } as const;
  const addRecipe = async (title: string, servings: number, lines: string[]) =>
    recipes.add({ ours: normalizeContent(contentInputSchema.parse({ title, servings, ingredients: lines.map((text) => ({ text })), steps: [] })), source: null }, by);
  const pates = await addRecipe('Pâtes au thon', 4, ['400 g de pâtes', '2 boîtes de thon', '20 cl de crème fraîche', '1 oignon', 'Sel, poivre']);
  const gratin = await addRecipe('Gratin', 4, ['150 g de gruyère râpé', '2 courgettes']);
  const croque = await addRecipe('Croque', 4, ['100 g de gruyère râpé', '8 tranches de pain de mie']);

  const product = async (code: string, name: string, quantity: string, count: number, link: StockLink) => {
    await stock.saveManual(code, { name, brand: null, quantity, category: null });
    await stock.add(code, count, null, by);
    await menus.setLink(code, link);
  };
  await product(PENNE, 'Penne', '500 g', 2, { key: 'pate', name: 'pâtes', per: { quantity: 500, unit: 'g' }, partial: true });
  await product(THON, 'Thon au naturel', '140 g', 3, { key: 'thon', name: 'thon', per: { quantity: 140, unit: 'g' } });
  await product(CREME, 'Crème fraîche', '20 cl', 1, { key: 'creme-fraiche', name: 'crème fraîche', per: { quantity: 20, unit: 'cl' }, partial: false });
  await product(GRUYERE, 'Gruyère râpé', '200 g', 1, { key: 'gruyere', name: 'gruyère', per: { quantity: 200, unit: 'g' }, partial: true });

  const phone = async (ownerId: string) => {
    const { code } = devices.createCode(ownerId);
    return (await devices.claim(code, `Téléphone de ${ownerId}`))!.token;
  };
  const call = (method: string, path: string, { from = OTHER, token, body }: CallOptions = {}) =>
    api.request(
      path,
      { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) },
      connectedFrom(from),
    );
  const alex = await phone('alex');
  const lea = await phone('lea');
  const add = async (recipeId: string, day: string | null, week = WEEK, people = 4) => {
    const res = await call('POST', '/menu/entries', { token: alex, body: { week, recipeId, people, day } });
    return ((await res.json()) as { id: string }).id;
  };
  const view = async (week = WEEK) => (await (await call('GET', `/menu?week=${week}`)).json()) as MenuView;
  const proposal = async (entryId: string, people?: number) => (await (await call('GET', `/menu/entries/${entryId}/cook${people ? `?people=${people}` : ''}`)).json()) as CookProposal;
  const quantity = async (code: string) => (await stock.data()).items.find((i) => i.product.code === code)!;
  const labels = async () => ((await (await call('GET', '/lists')).json()) as Lists).shopping.map((s) => s.label);
  const cookEntry = (entryId: string, replies: unknown[], token = lea, people: number | null = null) => call('POST', `/menu/entries/${entryId}/cook`, { token, body: { people, replies } });
  const setNow = (date: Date) => (now = date);
  return { call, alex, lea, add, view, proposal, quantity, labels, cookEntry, setNow, stock, menus, recipes, pates, gratin, croque, by };
}

const reply = (key: string, code: string, answer: unknown) => ({ key, code, container: null, answer });

describe('API « J’ai cuisiné » : proposition et décompte', () => {
  it('propose ligne par ligne, recalculée aux personnes', async () => {
    const { add, proposal, pates } = await setup();
    const id = await add(pates.id, '2026-11-02');
    const p = await proposal(id);
    expect(p).toMatchObject({ title: 'Pâtes au thon', people: 4, missing: false, meal: { id, day: '2026-11-02', cooked: null } });
    expect(p.lines.map((l) => [l.key, l.status, l.options[0]?.proposal ?? null])).toEqual([
      ['pate', 'stock', { action: 'left', finished: 0, estimate: 0.25 }],
      ['thon', 'stock', { action: 'remove', count: 2 }],
      ['creme-fraiche', 'stock', { action: 'remove', count: 1 }],
      ['oignon', 'untracked', null],
      ['sel', 'pantry', null],
    ]);
    // On était 6 : 600 g de pâtes, un paquet fini et il en reste ¾ du second.
    expect((await proposal(id, 6)).lines[0].options[0].proposal).toEqual({ action: 'left', finished: 1, estimate: 0.75 });
  });

  it('toute la famille décompte : sorties d’un coup, paquet entamé, mouvements groupés, épuisé proposé', async () => {
    const { add, cookEntry, quantity, view, pates, stock } = await setup();
    const id = await add(pates.id, '2026-11-02');
    const res = await cookEntry(id, [
      reply('pate', PENNE, { action: 'left', finished: 0, estimate: 0.25 }),
      reply('thon', THON, { action: 'remove', count: 2 }),
      reply('creme-fraiche', CREME, { action: 'remove', count: 1 }),
    ]);
    expect(res.status).toBe(201);
    const result = (await res.json()) as CookResult;
    expect(result).toMatchObject({ mealId: id, removed: ['penne (il en reste ¼)', 'thon au naturel × 2', 'crème fraîche'], propose: [{ code: CREME, label: 'Crème fraîche' }], added: [], returned: [] });
    expect(await quantity(THON)).toMatchObject({ quantity: 1 });
    expect(await quantity(CREME)).toMatchObject({ quantity: 0 });
    expect(await quantity(PENNE)).toMatchObject({ quantity: 2, opened: 0.25 });
    const movements: StockMovement[] = await stock.movements(THON);
    expect(movements[0]).toMatchObject({ kind: 'out', count: 2, reason: 'Cuisiné : Pâtes au thon', by: { ownerId: 'lea', via: 'phone' } });
    expect((await stock.movements(PENNE))[0]).toMatchObject({ kind: 'opened', count: 0, opened: 0.25 });
    const entry = (await view()).entries[0];
    expect(entry.cooked).toMatchObject({ by: { ownerId: 'lea' }, keys: ['pate', 'thon', 'creme-fraiche'], people: 4 });
  });

  it('même repas noté deux fois : le second est refusé', async () => {
    const { add, cookEntry, pates, alex } = await setup();
    const id = await add(pates.id, '2026-11-02');
    expect((await cookEntry(id, [reply('thon', THON, { action: 'remove', count: 2 })])).status).toBe(201);
    const second = await cookEntry(id, [reply('thon', THON, { action: 'remove', count: 1 })], alex);
    expect(second.status).toBe(409);
  });

  it('la tablette sans visage décompte ; un appareil non appairé non', async () => {
    const { add, call, pates } = await setup();
    const id = await add(pates.id, '2026-11-02');
    expect((await call('POST', `/menu/entries/${id}/cook`, { body: { replies: [] } })).status).toBe(403);
    const res = await call('POST', `/menu/entries/${id}/cook`, { from: TABLET, body: { replies: [] } });
    expect(res.status).toBe(201);
  });

  it('refuse une réponse impossible : plus que le stock, ingrédient pas suivi, deux réponses', async () => {
    const { add, cookEntry, pates } = await setup();
    const id = await add(pates.id, '2026-11-02');
    expect((await cookEntry(id, [reply('thon', THON, { action: 'remove', count: 4 })])).status).toBe(400);
    expect((await cookEntry(id, [reply('oignon', THON, { action: 'remove', count: 1 })])).status).toBe(400);
    expect((await cookEntry(id, [reply('thon', CREME, { action: 'remove', count: 1 })])).status).toBe(400);
    expect((await cookEntry(id, [reply('thon', THON, { action: 'unused' }), reply('thon', THON, { action: 'remove', count: 1 })])).status).toBe(400);
    expect((await cookEntry(id, [reply('creme-fraiche', CREME, { action: 'left', finished: 0, estimate: 0.5 })])).status).toBe(400);
  });
});

describe('API « J’ai cuisiné » : courses du menu', () => {
  it('un repas cuisiné ne remet pas sur la liste ce qu’on vient de retirer', async () => {
    const { add, cookEntry, labels, view, pates } = await setup();
    const id = await add(pates.id, '2026-11-02');
    // Boîtes et grammes ne se comparent pas : le thon reste dans les courses (en cas de doute, on achète).
    expect(await labels()).toEqual(['Thon · 2 boîtes', 'Oignon · 1']);
    await cookEntry(id, [reply('thon', THON, { action: 'remove', count: 3 }), reply('creme-fraiche', CREME, { action: 'remove', count: 1 }), reply('pate', PENNE, { action: 'remove', count: 2 })]);
    // Plus de thon, de crème ni de pâtes en stock, mais le repas est mangé : rien à racheter pour lui. L'oignon, sans
    // réponse, compte encore.
    expect(await labels()).toEqual(['Oignon · 1']);
    expect((await view()).plan.map((l) => l.key)).toEqual(['oignon', 'sel']);
  });

  it('« Ne rien retirer » : noté cuisiné, ses ingrédients comptent encore', async () => {
    const { add, cookEntry, view, quantity, pates } = await setup();
    const id = await add(pates.id, '2026-11-02');
    expect((await cookEntry(id, [])).status).toBe(201);
    expect(await quantity(THON)).toMatchObject({ quantity: 3 });
    const v = await view();
    expect(v.entries[0].cooked?.keys).toEqual([]);
    expect(v.plan.map((l) => l.key)).toContain('thon');
  });

  it('le paquet entamé connu compte pour sa part, sans « à vérifier au placard »', async () => {
    const { add, cookEntry, view, call, alex, croque, gratin } = await setup();
    await add(gratin.id, '2026-11-06');
    // Paquet peut-être entamé : 150 g contre un paquet de 200 g, à vérifier au placard.
    expect((await view()).plan.find((l) => l.key === 'gruyere')!.check).toBe('ask');
    const croqueId = await add(croque.id, '2026-11-02');
    await cookEntry(croqueId, [reply('gruyere', GRUYERE, { action: 'left', finished: 0, estimate: 0.75 })]);
    // Il en reste ¾ de 200 g = 150 g : le gratin est couvert, rien à vérifier.
    expect((await view()).plan.find((l) => l.key === 'gruyere')).toMatchObject({ status: 'stock', check: null });
    await call('DELETE', `/menu/entries/${croqueId}/cook`, { token: alex });
    await cookEntry(croqueId, [reply('gruyere', GRUYERE, { action: 'left', finished: 0, estimate: 0.25 })]);
    // ¼ = 50 g : 100 g à acheter, toujours sans vérification.
    expect((await view()).plan.find((l) => l.key === 'gruyere')).toMatchObject({ status: 'buy', buy: { masse: 100 }, check: null });
  });

  it('« Paquet fini » retire la coche « j’en ai déjà » si un autre repas en a besoin, et efface « j’en ai assez »', async () => {
    const { add, cookEntry, call, alex, menus, croque, gratin, proposal } = await setup();
    const croqueId = await add(croque.id, '2026-11-02');
    await add(gratin.id, '2026-11-06');
    await call('PUT', '/menu/have', { token: alex, body: { week: WEEK, key: 'gruyere', have: true } });
    await call('PUT', '/menu/check', { token: alex, body: { week: WEEK, key: 'gruyere', decision: 'enough' } });
    expect((await proposal(croqueId)).lines[0].key).toBe('gruyere');
    const res = await cookEntry(croqueId, [reply('gruyere', GRUYERE, { action: 'remove', count: 1 })]);
    expect(((await res.json()) as CookResult).returned).toEqual([{ name: 'Gruyère', sources: ['Gratin'] }]);
    let data = await menus.data();
    expect(data.have[WEEK] ?? []).not.toContain('gruyere');
    expect(data.checks[WEEK]?.gruyere).toBeUndefined();
    // Annuler rend la coche et la décision.
    await call('DELETE', `/menu/entries/${croqueId}/cook`, { token: alex });
    data = await menus.data();
    expect(data.have[WEEK]).toContain('gruyere');
    expect(data.checks[WEEK]?.gruyere).toBe('enough');
  });

  it('produit épuisé réglé « d’office » : ajouté à la liste, retiré si on annule', async () => {
    const { add, cookEntry, call, labels, stock, pates, alex } = await setup();
    await stock.setPreferences(CREME, { autoShop: true });
    const id = await add(pates.id, '2026-11-02');
    const result = (await (await cookEntry(id, [reply('creme-fraiche', CREME, { action: 'remove', count: 1 })])).json()) as CookResult;
    expect(result).toMatchObject({ added: ['Crème fraîche'], propose: [] });
    expect(await labels()).toContain('Crème fraîche');
    await call('DELETE', `/menu/entries/${id}/cook`, { token: alex });
    expect(await labels()).not.toContain('Crème fraîche');
  });
});

describe('API « J’ai cuisiné » : annuler', () => {
  it('défait chaque mouvement encore dernier de son produit, et signale les autres', async () => {
    const { add, cookEntry, call, quantity, view, stock, pates, by } = await setup();
    const id = await add(pates.id, '2026-11-02');
    const result = (await (await cookEntry(id, [reply('thon', THON, { action: 'remove', count: 2 }), reply('creme-fraiche', CREME, { action: 'remove', count: 1 }), reply('pate', PENNE, { action: 'left', finished: 1, estimate: 0.5 })])).json()) as CookResult;
    await stock.add(THON, 1, null, by); // rescanné depuis
    const res = await call('DELETE', `/cooks/${result.cook}`, { from: TABLET });
    expect((await res.json()) as CookUndo).toEqual({ undone: 2, kept: ['Thon au naturel'] });
    expect(await quantity(CREME)).toMatchObject({ quantity: 1 });
    expect(await quantity(PENNE)).toMatchObject({ quantity: 2, opened: null });
    expect(await quantity(THON)).toMatchObject({ quantity: 2 });
    expect((await view()).entries[0].cooked).toBeUndefined();
    expect((await call('DELETE', `/menu/entries/${id}/cook`, { from: TABLET })).status).toBe(409);
  });

  it('hors menu : mêmes mouvements, aucun repas marqué, annulables', async () => {
    const { call, quantity, view, pates, lea } = await setup();
    const p = (await (await call('GET', `/recipes/${pates.id}/cook?entry=none&people=2`)).json()) as CookProposal;
    expect(p).toMatchObject({ meal: null, people: 2 });
    const res = await call('POST', `/recipes/${pates.id}/cook`, { token: lea, body: { entryId: null, people: 2, replies: [reply('thon', THON, { action: 'remove', count: 1 })] } });
    const result = (await res.json()) as CookResult;
    expect(result).toMatchObject({ mealId: null, removed: ['thon au naturel'] });
    expect(await quantity(THON)).toMatchObject({ quantity: 2 });
    expect((await view()).entries).toEqual([]);
    expect((await call('DELETE', `/cooks/${result.cook}`, { token: lea })).status).toBe(200);
    expect(await quantity(THON)).toMatchObject({ quantity: 3 });
    expect((await call('DELETE', `/cooks/${result.cook}`, { token: lea })).status).toBe(404);
  });
});

describe('API « J’ai cuisiné » : repas, fenêtre et rappel', () => {
  it('le mode cuisine prend le repas d’aujourd’hui, sinon le plus récent pas cuisiné ; deux fois au menu : chacun à part', async () => {
    const { add, call, cookEntry, menus, pates, by } = await setup();
    // Semaine passée : le menu ne s'y modifie plus, le repas est posé directement.
    const sunday = (await menus.addEntry('2026-10-26', { recipeId: pates.id, title: 'Pâtes au thon', people: 4, day: '2026-11-01' }, by)).id;

    const monday = await add(pates.id, '2026-11-02');
    const pick = async () => (await (await call('GET', `/recipes/${pates.id}/cook`)).json()) as CookProposal;
    expect((await pick()).meal?.id).toBe(monday);
    expect((await pick()).meals.map((m) => m.id).sort()).toEqual([sunday, monday].sort());
    await cookEntry(monday, []);
    expect((await pick()).meal?.id).toBe(sunday);
  });

  it('semaine en cours, plus deux jours ; jamais une semaine à venir', async () => {
    const { add, cookEntry, setNow, pates, call, alex } = await setup();
    const next = await add(pates.id, '2026-11-09', '2026-11-09');
    expect((await cookEntry(next, [])).status).toBe(400);
    const id = await add(pates.id, '2026-11-05');
    setNow(new Date(2026, 10, 10, 20, 0)); // mardi suivant : encore possible
    expect((await cookEntry(id, [])).status).toBe(201);
    setNow(new Date(2026, 10, 11, 9, 0)); // mercredi : trop tard, même pour annuler
    expect((await call('DELETE', `/menu/entries/${id}/cook`, { token: alex })).status).toBe(400);
  });

  it('recette retirée du carnet : « Cuisiné ? » note seulement le repas', async () => {
    const { add, cookEntry, proposal, recipes, gratin } = await setup();
    const id = await add(gratin.id, '2026-11-02');
    await recipes.remove(gratin.id);
    const p = await proposal(id);
    expect(p).toMatchObject({ title: 'Gratin', missing: true, lines: [], meal: { id } });
    expect((await cookEntry(id, [reply('gruyere', GRUYERE, { action: 'remove', count: 1 })])).status).toBe(400);
    expect((await cookEntry(id, [])).status).toBe(201);
  });

  it('rappel : repas passés pas encore notés (rien de personnel)', async () => {
    const { add, call, cookEntry, setNow, pates, gratin } = await setup();
    const a = await add(pates.id, '2026-11-02');
    await add(gratin.id, '2026-11-03');
    await add(gratin.id, null);
    setNow(new Date(2026, 10, 4, 9, 0));
    expect(await (await call('GET', '/menu/reminder')).json()).toEqual({ count: 2 });
    await cookEntry(a, []);
    expect(await (await call('GET', '/menu/reminder')).json()).toEqual({ count: 1 });
  });
});

describe('stock après un décompte', () => {
  it('le stock montre la part restante du paquet entamé', async () => {
    const { add, cookEntry, stock, croque } = await setup();
    const id = await add(croque.id, '2026-11-02');
    await cookEntry(id, [reply('gruyere', GRUYERE, { action: 'left', finished: 0, estimate: 0.75 })]);
    const data: StockData = await stock.data();
    expect(data.items.find((i) => i.product.code === GRUYERE)?.opened).toBe(0.75);
  });
});
