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
import { createRouter } from './http.ts';
import { createRecipesApi, createShareRoute, firstLink, NOT_YOURS, REFUSED_REASON } from './recipes-api.ts';
import { createShareInbox } from './services/recipe-imports.ts';
import { createRecipeImporter } from './services/recipes.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createRecipeNoteStore } from './sources/recipe-notes.ts';
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
      if (url.includes('refus')) throw new PageError('refused', 'Le site a refusé la lecture (HTTP 403)');
      if (url.includes('192.168')) throw new PageError('forbidden', 'Adresse locale ou privée refusée');
      const page = WEB[url];
      if (!page) throw new PageError('not-found', 'Page introuvable');
      return page();
    },
  });
  const inbox = createShareInbox();
  const api = createRouter();
  api.route('/', createRecipesApi({ recipes, notes: createRecipeNoteStore({ path: join(dir, 'recipe-notes.json'), clock: fixedClock }), importer, access, clock: fixedClock, inbox }));
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
  /** Envoi d'un fichier (multipart), comme le fait le front. */
  const upload = (path: string, form: FormData, { from = OTHER, token }: CallOptions = {}) =>
    api.request(path, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form }, connectedFrom(from));
  return { call, phone, tablet, fetched, upload, inbox };
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

const pastedText = readFileSync(new URL('../shared/fixtures/recette-copiee-bruitee.txt', import.meta.url), 'utf8');
const savedPage = readFileSync(new URL('./sources/fixtures/recettes/page-enregistree.mhtml', import.meta.url));
const pageForm = (bytes: Uint8Array = savedPage, name = 'clafoutis.mhtml') => {
  const form = new FormData();
  form.set('page', new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'multipart/related' }));
  return form;
};
type Preview = { preview: { token: string; content: Recipe['ours']; url: string | null; site: string; origin: string; photo: boolean } };

describe('API des recettes : site qui refuse la lecture', () => {
  it('le refus propose le texte copié ou la page enregistrée, sans rien contourner', async () => {
    const { call, phone, fetched } = await setup();
    const res = await importAs(call, { token: await phone('alex') }, 'https://refus.exemple.test/gratin');
    expect(await res.json()).toEqual({
      draft: { url: 'https://refus.exemple.test/gratin', title: null, site: 'refus.exemple.test' },
      reason: REFUSED_REASON,
      refused: true,
    });
    expect(fetched).toEqual(['https://refus.exemple.test/gratin']); // une seule tentative, honnête
  });
});

describe('API des recettes : texte collé', () => {
  it('donne un aperçu sans rien enregistrer ni lire sur le réseau, puis enregistre la version corrigée', async () => {
    const { call, phone, fetched } = await setup();
    const token = await phone('lea');
    const res = await call('POST', '/recipes/import-text', { token, body: { text: pastedText } });
    expect(res.status).toBe(200);
    const { preview } = (await res.json()) as Preview;
    expect(preview).toMatchObject({ url: 'https://petit-fourneau.example/recettes/gratin-courgettes-chevre', site: 'petit-fourneau.example', origin: 'text', photo: false });
    expect(preview.content).toMatchObject({ title: 'Gratin de courgettes au chèvre', servings: 4, prepMinutes: 20, cookMinutes: 35 });
    expect(fetched).toEqual([]);
    expect((await (await call('GET', '/recipes')).json()).recipes).toEqual([]);

    const corrected = { ...preview.content, title: 'Gratin de Léa' };
    const saved = await call('POST', '/recipes', { token, body: { content: corrected, pending: preview.token } });
    expect(saved.status).toBe(201);
    const recipe = (await saved.json()) as Recipe;
    expect(recipe.ours.title).toBe('Gratin de Léa');
    expect(recipe.addedBy).toMatchObject({ ownerId: 'lea', via: 'phone' });
    expect(recipe.source).toMatchObject({ url: preview.url, origin: 'text', site: 'petit-fourneau.example', imageUrl: null });
    expect(recipe.source?.content?.title).toBe('Gratin de courgettes au chèvre'); // telle que lue

    // L'aperçu ne sert qu'une fois ; la même page est ensuite reconnue au carnet.
    expect((await call('POST', '/recipes', { token, body: { content: corrected, pending: preview.token } })).status).toBe(410);
    expect(await (await call('POST', '/recipes/import-text', { token, body: { text: pastedText } })).json()).toMatchObject({ existing: true, recipe: { id: recipe.id } });
  });

  it('sans lien : « Texte collé », lien facultatif donné à part', async () => {
    const { call, phone } = await setup();
    const token = await phone('alex');
    const text = 'Crêpes\nIngrédients\n250 g de farine\n4 œufs\nPréparation\nMélanger.';
    const alone = (await (await call('POST', '/recipes/import-text', { token, body: { text } })).json()) as Preview;
    expect(alone.preview).toMatchObject({ url: null, site: 'Texte collé' });
    const linked = (await (await call('POST', '/recipes/import-text', { token, body: { text, url: 'https://www.marmiton.org/recettes/crepes' } })).json()) as Preview;
    expect(linked.preview).toMatchObject({ url: 'https://www.marmiton.org/recettes/crepes', site: 'Marmiton' });
    const saved = (await (await call('POST', '/recipes', { token, body: { content: alone.preview.content, pending: alone.preview.token } })).json()) as Recipe;
    expect(saved.source).toMatchObject({ url: null, origin: 'text', site: 'Texte collé' });
    const reread = await call('POST', `/recipes/${saved.id}/reread`, { token });
    expect(reread.status).toBe(400);
    // Le lien peut être donné à l'aperçu.
    const again = (await (await call('POST', '/recipes/import-text', { token, body: { text } })).json()) as Preview;
    const withLink = (await (await call('POST', '/recipes', { token, body: { content: again.preview.content, pending: again.preview.token, url: 'https://jow.fr/recipes/crepes-1' } })).json()) as Recipe;
    expect(withLink.source).toMatchObject({ url: 'https://jow.fr/recipes/crepes-1', site: 'Jow', origin: 'text' });
  });

  it('un texte sans recette est refusé ; il faut quelqu’un d’identifié', async () => {
    const { call, phone, tablet } = await setup();
    expect((await call('POST', '/recipes/import-text', { token: await phone('tom'), body: { text: 'Acheter du pain' } })).status).toBe(422);
    expect((await call('POST', '/recipes/import-text', { body: { text: pastedText } })).status).toBe(403);
    const anonymous = await call('POST', '/recipes/import-text', { from: TABLET, body: { text: pastedText } });
    expect(anonymous.status).toBe(403);
    expect(await anonymous.json()).toMatchObject({ identify: true }); // la tablette demande qui est là
    expect((await call('POST', '/recipes/import-text', { ...tablet('tom'), body: { text: pastedText } })).status).toBe(200);
    expect((await call('POST', '/recipes/import-text', { token: await phone('tom'), body: { text: '' } })).status).toBe(400);
  });
});

describe('API des recettes : page enregistrée', () => {
  it('lit l’archive envoyée, avec la photo qu’elle contient, sans requête vers le site', async () => {
    const { call, phone, fetched, upload } = await setup();
    const token = await phone('sam');
    const res = await upload('/recipes/import-page', pageForm(), { token });
    expect(res.status).toBe(200);
    const { preview } = (await res.json()) as Preview;
    expect(preview).toMatchObject({ url: 'https://petit-fourneau.example/recettes/clafoutis-cerises', site: 'Le Petit Fourneau', origin: 'saved-page', photo: true });
    expect(preview.content).toMatchObject({ title: 'Clafoutis aux cerises', servings: 6 });
    expect(fetched).toEqual([]);

    const recipe = (await (await call('POST', '/recipes', { token, body: { content: preview.content, pending: preview.token } })).json()) as Recipe;
    expect(recipe).toMatchObject({ photo: true, source: { origin: 'saved-page', imageUrl: 'https://petit-fourneau.example/img/clafoutis.png' } });
    const photo = await call('GET', `/recipes/${recipe.id}/photo`);
    expect(photo.headers.get('content-type')).toBe('image/png');
  });

  it('page partagée : déposée par POST /partager, puis réclamée une seule fois par l’appli', async () => {
    const { call, phone, inbox } = await setup();
    const share = createShareRoute(inbox);
    const form = pageForm();
    form.set('title', 'Clafoutis aux cerises');
    const res = await share.request('/partager', { method: 'POST', body: form });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location')!, 'http://homehub.test');
    expect(location.pathname).toBe('/partager');
    expect(location.searchParams.get('title')).toBe('Clafoutis aux cerises');
    const shared = location.searchParams.get('fichier')!;

    // Sans droit : refusé, et le fichier reste à réclamer.
    expect((await call('POST', '/recipes/import-page', { body: { shared } })).status).toBe(403);
    const token = await phone('lea');
    expect((await call('POST', '/recipes/import-page', { token, body: { shared } })).status).toBe(200);
    expect((await call('POST', '/recipes/import-page', { token, body: { shared } })).status).toBe(410);
  });

  it('un lien ou un texte partagé repart en GET comme avant', async () => {
    const share = createShareRoute(createShareInbox());
    const form = new FormData();
    form.set('text', 'Regarde https://jow.fr/recipes/poulet-123');
    const res = await share.request('/partager', { method: 'POST', body: form });
    expect(res.headers.get('location')).toBe('/partager?text=Regarde+https%3A%2F%2Fjow.fr%2Frecipes%2Fpoulet-123');
  });

  it('refuse un fichier qui n’est pas une page, ou sans recette', async () => {
    const { phone, upload } = await setup();
    const token = await phone('alex');
    const pdf = await upload('/recipes/import-page', pageForm(Uint8Array.from(Buffer.from('%PDF-1.7')), 'x.pdf'), { token });
    expect(pdf.status).toBe(400);
    expect((await pdf.json()).error).toMatch(/pas une page enregistrée/u);
    const empty = Buffer.from('Content-Type: text/html\nContent-Location: https://exemple.test/vide\n\n<title>Vide</title><p>Rien ici.</p>');
    expect((await upload('/recipes/import-page', pageForm(Uint8Array.from(empty)), { token })).status).toBe(422);
    expect((await upload('/recipes/import-page', pageForm(), {})).status).toBe(403);
  });
});

describe('firstLink', () => {
  it('trouve le lien dans un texte partagé', () => {
    expect(firstLink('Poulet curry https://jow.fr/recipes/poulet-123 via Jow')).toBe('https://jow.fr/recipes/poulet-123');
    expect(firstLink('(https://exemple.test/a).')).toBe('https://exemple.test/a');
    expect(firstLink('rien')).toBeNull();
  });
});
