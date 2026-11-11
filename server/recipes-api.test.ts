// Tests de l'API du carnet : import d'un lien (page inventée, sans réseau), doublons, saisie à la main en secours,
// photo, relecture de la source, et droits : qui importe (tout membre identifié), qui modifie ou relit (un parent ou
// l'auteur), qui retire (un parent).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Recipe, RereadResult } from '../shared/recipes.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createRecipesApi, firstLink, NOT_YOURS } from './recipes-api.ts';
import { createRecipeImporter } from './services/recipes.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createRecipeStore } from './sources/recipes.ts';
import { type FetchedPage, PageError } from './sources/web-page.ts';
import { connectedFrom, fixedClock } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const PAGE = 'https://cuisine.exemple.test/galettes';
const html = readFileSync(new URL('./sources/fixtures/recettes/graphe.html', import.meta.url));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const POT = 'https://cuisine.exemple.test/pot-au-feu';
const potAuFeu = readFileSync(new URL('./sources/fixtures/recettes/etapes-html.html', import.meta.url), 'utf8');
/** La page du pot-au-feu telle que le serveur la lit (sans étapes lisibles tant que `potSteps` est faux). */
let potSteps = false;

type CallOptions = { from?: string; token?: string; actor?: string; body?: unknown };

/** Pages servies par le faux réseau. */
const WEB: Record<string, () => FetchedPage> = {
  [PAGE]: () => ({ url: PAGE, contentType: 'text/html; charset=utf-8', body: html }),
  'https://cuisine.exemple.test/court': () => ({ url: PAGE, contentType: 'text/html', body: html }),
  'https://cuisine.exemple.test/photos/galettes.jpg': () => ({ url: '', contentType: 'image/png', body: PNG }),
  'https://cuisine.exemple.test/blog': () => ({ url: 'https://cuisine.exemple.test/blog', contentType: 'text/html', body: Buffer.from('<title>Mon blog</title>') }),
  [POT]: () => ({ url: POT, contentType: 'text/html', body: Buffer.from(potSteps ? potAuFeu : potAuFeu.replaceAll('Étape', 'Temps')) }),
  'https://cuisine.exemple.test/images/pot_au_feu.jpg': () => ({ url: '', contentType: 'image/png', body: PNG }),
  'https://cuisine.exemple.test/fichier.pdf': () => ({ url: '', contentType: 'application/pdf', body: new Uint8Array() }),
};

async function setup() {
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'sam', name: 'Sam', color: '#e0a03a', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
        { id: 'tom', name: 'Tom', color: '#d96aa7' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-recipes-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock: fixedClock });
  const sessions = createActorSessions(fixedClock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const recipes = createRecipeStore({ path: join(dir, 'recipes.json'), photosDir: join(dir, 'recipes'), clock: fixedClock });
  const fetched: string[] = [];
  const importer = createRecipeImporter({
    fetchPage: async (url) => {
      fetched.push(url);
      if (url.includes('lent')) throw new PageError('unreachable', 'Le site met trop de temps à répondre');
      if (url.includes('192.168')) throw new PageError('forbidden', 'Adresse locale ou privée refusée');
      const page = WEB[url];
      if (!page) throw new PageError('not-found', 'Page introuvable');
      return page();
    },
  });
  const api = createRouter();
  api.route('/', createRecipesApi({ recipes, importer, household: createHousehold(config), access, clock: fixedClock }));
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
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(actor && { 'X-Actor-Session': actor }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      connectedFrom(from),
    );
  return { call, phone, tablet, fetched };
}

const importAs = async (call: Awaited<ReturnType<typeof setup>>['call'], options: CallOptions, url = PAGE) =>
  call('POST', '/recipes/import', { ...options, body: { url } });

describe('API des recettes : import', () => {
  it('importe une recette partagée depuis un téléphone, avec sa source et sa photo', async () => {
    const { call, phone } = await setup();
    const token = await phone('lea');
    const res = await importAs(call, { token }, `Regarde ça : ${PAGE} !`);
    expect(res.status).toBe(201);
    const { recipe, existing } = (await res.json()) as { recipe: Recipe; existing: boolean };
    expect(existing).toBe(false);
    expect(recipe).toMatchObject({ photo: true, addedBy: { ownerId: 'lea', via: 'phone' } });
    expect(recipe.ours.title).toBe('Galettes du dimanche');
    expect(recipe.source).toMatchObject({ url: PAGE, site: "Cuisine d'exemple", imageUrl: 'https://cuisine.exemple.test/photos/galettes.jpg' });
    expect(recipe.source?.content).toEqual(recipe.ours);

    const photo = await call('GET', `/recipes/${recipe.id}/photo`);
    expect(photo.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(PNG);

    const { recipes } = await (await call('GET', '/recipes')).json();
    expect(recipes).toEqual([expect.objectContaining({ id: recipe.id, title: 'Galettes du dimanche', servings: 12, servingsUnit: 'galettes', site: "Cuisine d'exemple", ingredients: 5 })]);
  });

  it('une page déjà au carnet n’est pas importée deux fois (adresse finale comprise)', async () => {
    const { call, phone } = await setup();
    const token = await phone('alex');
    const first = await (await importAs(call, { token })).json();
    const again = await importAs(call, { token }, `${PAGE}?utm_source=appli#etapes`);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ existing: true, recipe: { id: first.recipe.id } });
    const redirected = await (await importAs(call, { token }, 'https://cuisine.exemple.test/court')).json();
    expect(redirected).toMatchObject({ existing: true, recipe: { id: first.recipe.id } });
  });

  it('rien de lisible, site injoignable : de quoi saisir à la main', async () => {
    const { call, phone } = await setup();
    const token = await phone('alex');
    expect(await (await importAs(call, { token }, 'https://cuisine.exemple.test/blog')).json()).toEqual({
      draft: { url: 'https://cuisine.exemple.test/blog', title: 'Mon blog', site: 'cuisine.exemple.test' },
      reason: 'Aucune recette lisible sur cette page',
    });
    expect(await (await importAs(call, { token }, 'https://lent.exemple.test/r')).json()).toMatchObject({ reason: 'Le site met trop de temps à répondre' });
  });

  it('refuse les liens interdits ou qui ne sont pas des pages', async () => {
    const { call, phone } = await setup();
    const token = await phone('alex');
    const local = await importAs(call, { token }, 'http://192.168.1.1/admin');
    expect(local.status).toBe(400);
    expect((await local.json()).error).toBe('Adresse locale ou privée refusée');
    expect((await importAs(call, { token }, 'pas de lien ici')).status).toBe(400);
    expect((await importAs(call, { token }, 'https://cuisine.exemple.test/fichier.pdf')).status).toBe(400);
  });

  it('un appareil non appairé ne fait rien lire au serveur', async () => {
    const { call, fetched } = await setup();
    expect((await importAs(call, {})).status).toBe(403);
    // La tablette sans personne reconnue : il faut d'abord se montrer.
    const kiosk = await importAs(call, { from: TABLET });
    expect(await kiosk.json()).toMatchObject({ identify: true });
    expect(fetched).toEqual([]);
  });

  it('la tablette importe pour la personne reconnue', async () => {
    const { call, tablet } = await setup();
    const res = await importAs(call, tablet('tom'));
    expect(res.status).toBe(201);
    expect((await res.json()).recipe.addedBy).toEqual({ ownerId: 'tom', via: 'tablet' });
  });
});

describe('API des recettes : saisie à la main et notre version', () => {
  const content = {
    title: 'Gâteau de mamie',
    servings: 6,
    ingredients: [{ text: '200 g de chocolat' }, { text: '3 œufs' }],
    steps: [{ text: 'Faire fondre le chocolat.' }, { text: 'Cuire 25 minutes.' }],
  };

  it('saisie à la main, lignes analysées, lien gardé sans contenu de source', async () => {
    const { call, phone } = await setup();
    const res = await call('POST', '/recipes', { token: await phone('sam'), body: { content, url: 'https://cuisine.exemple.test/blog' } });
    expect(res.status).toBe(201);
    const recipe = (await res.json()) as Recipe;
    expect(recipe.ours.ingredients.map((i) => [i.quantity, i.unit, i.key])).toEqual([[200, 'g', 'chocolat'], [3, 'piece', 'oeuf']]);
    expect(recipe.ours.steps.every((s) => s.id.length > 0)).toBe(true);
    expect(recipe.source).toMatchObject({ url: 'https://cuisine.exemple.test/blog', content: null });
    expect(recipe.photo).toBe(false);
  });

  it('notre version se modifie ; la source reste telle que lue ; une correction à la main est retenue', async () => {
    const { call, phone } = await setup();
    const token = await phone('alex');
    const { recipe } = (await (await importAs(call, { token })).json()) as { recipe: Recipe };
    const ours = structuredClone(recipe.ours);
    ours.servings = 6;
    ours.tips = 'Ajouter une pincée de cumin.';
    ours.ingredients[0] = { ...ours.ingredients[0], text: '125 g de farine de sarrasin' };
    ours.ingredients[1] = { ...ours.ingredients[1], quantity: 1, name: 'œuf extra-frais', manual: true };
    const res = await call('PUT', `/recipes/${recipe.id}`, { token, body: { content: ours } });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Recipe;
    expect(saved.ours).toMatchObject({ servings: 6, tips: 'Ajouter une pincée de cumin.' });
    expect(saved.ours.ingredients[0]).toMatchObject({ quantity: 125, text: '125 g de farine de sarrasin', manual: false });
    expect(saved.ours.ingredients[1]).toMatchObject({ quantity: 1, name: 'œuf extra-frais', key: 'oeuf-extra-frais', manual: true });
    expect(saved.source?.content).toEqual(recipe.source?.content);
    expect(saved.updatedBy).toEqual({ ownerId: 'alex', via: 'phone' });
  });

  it('refuse une version sans titre', async () => {
    const { call, phone } = await setup();
    const res = await call('POST', '/recipes', { token: await phone('alex'), body: { content: { ...content, title: ' ' } } });
    expect(res.status).toBe(400);
  });
});

describe('API des recettes : relire la source', () => {
  it('reprend les étapes que la première lecture n’avait pas, sans toucher à ce que notre version a modifié', async () => {
    const { call, phone } = await setup();
    const token = await phone('lea');
    potSteps = false;
    const { recipe } = (await (await importAs(call, { token }, POT)).json()) as { recipe: Recipe };
    expect(recipe.ours.steps).toEqual([]);
    const ours = { ...recipe.ours, title: 'Pot-au-feu de Léa', tips: 'Avec des navets.' };
    await call('PUT', `/recipes/${recipe.id}`, { token, body: { content: ours } });

    potSteps = true;
    const res = await call('POST', `/recipes/${recipe.id}/reread`, { token });
    expect(res.status).toBe(200);
    const result = (await res.json()) as RereadResult;
    expect(result.updated).toEqual(['étapes']);
    expect(result.kept).toEqual(['titre']);
    expect(result.recipe.ours).toMatchObject({ title: 'Pot-au-feu de Léa', tips: 'Avec des navets.' });
    expect(result.recipe.ours.steps).toHaveLength(4);
    expect(result.recipe.source?.content?.steps).toHaveLength(4);
    expect(result.recipe.source?.content?.title).toBe('Pot-au-feu express au Cookeo');

    // Relire encore : rien de nouveau.
    expect(await (await call('POST', `/recipes/${recipe.id}/reread`, { token })).json()).toMatchObject({ updated: [], kept: ['titre'] });
  });

  it('droits et cas sans page : un autre enfant, une saisie à la main, une page devenue illisible', async () => {
    const { call, phone, tablet } = await setup();
    const lea = await phone('lea');
    const { recipe } = (await (await importAs(call, { token: lea })).json()) as { recipe: Recipe };
    expect((await call('POST', `/recipes/${recipe.id}/reread`, tablet('tom'))).status).toBe(403);
    expect((await call('POST', `/recipes/${recipe.id}/reread`, tablet('sam'))).status).toBe(200);

    const manual = (await (await call('POST', '/recipes', { token: lea, body: { content: { title: 'Gâteau', servings: null, ingredients: [], steps: [] } } })).json()) as Recipe;
    expect((await call('POST', `/recipes/${manual.id}/reread`, { token: lea })).status).toBe(400);

    const blog = (await (await call('POST', '/recipes', { token: lea, body: { content: { title: 'Blog', servings: null, ingredients: [], steps: [] }, url: 'https://cuisine.exemple.test/blog' } })).json()) as Recipe;
    const unreadable = await call('POST', `/recipes/${blog.id}/reread`, { token: lea });
    expect(unreadable.status).toBe(422);
    expect((await unreadable.json()).error).toBe('Aucune recette lisible sur cette page');
  });
});

describe('API des recettes : droits', () => {
  it('modifier : un parent ou celui qui a ajouté la recette ; retirer : un parent', async () => {
    const { call, phone, tablet } = await setup();
    const lea = await phone('lea');
    const { recipe } = (await (await importAs(call, { token: lea })).json()) as { recipe: Recipe };
    const body = { content: { ...recipe.ours, tips: 'Avec du caramel.' } };

    expect((await call('PUT', `/recipes/${recipe.id}`, { token: lea, body })).status).toBe(200);
    const tom = await call('PUT', `/recipes/${recipe.id}`, { ...tablet('tom'), body });
    expect(tom.status).toBe(403);
    expect((await tom.json()).error).toBe(NOT_YOURS);
    expect((await call('PUT', `/recipes/${recipe.id}`, { ...tablet('sam'), body })).status).toBe(200);
    expect((await call('PUT', `/recipes/${recipe.id}`, { body })).status).toBe(403);

    expect((await call('DELETE', `/recipes/${recipe.id}`, { token: lea })).status).toBe(403);
    expect((await call('DELETE', `/recipes/${recipe.id}`, { token: await phone('alex') })).status).toBe(204);
    expect((await call('GET', `/recipes/${recipe.id}`)).status).toBe(404);
    expect((await call('GET', `/recipes/${recipe.id}/photo`)).status).toBe(404);
  });

  it('le carnet se lit depuis la tablette ou un téléphone', async () => {
    const { call, phone } = await setup();
    expect((await call('GET', '/recipes', { from: TABLET })).status).toBe(200);
    expect((await call('GET', '/recipes', { token: await phone('tom') })).status).toBe(200);
  });
});

describe('firstLink', () => {
  it('trouve le lien dans un texte partagé', () => {
    expect(firstLink('Poulet curry https://jow.fr/recipes/poulet-123 via Jow')).toBe('https://jow.fr/recipes/poulet-123');
    expect(firstLink('(https://exemple.test/a).')).toBe('https://exemple.test/a');
    expect(firstLink('rien')).toBeNull();
  });
});
