// Routes du carnet de recettes. Lecture ouverte comme le reste de l'API (le carnet est familial, rien de personnel).
// Importer ou saisir une recette : tout membre identifié (téléphone appairé, ou personne reconnue à la tablette),
// enfants compris. Modifier notre version, ou relire la page d'origine (sans écraser ce que notre version a modifié) :
// un parent, ou celui qui a ajouté la recette. Retirer : un parent. Quand un site refuse la lecture, deux autres
// chemins passent par le navigateur de la personne : le texte copié de la page, ou la page enregistrée (.mhtml) ; ils
// donnent un aperçu, enregistré seulement une fois corrigé. Une page enregistrée partagée depuis Chrome arrive par
// POST /partager (route hors de l'API, voir createShareRoute).
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { RECIPE_TEXT_MAX } from '../shared/recipe-text.ts';
import { type ImportPreview, type ImportResult, mergeReread, type Recipe, type RecipeDraft, type RereadResult } from '../shared/recipes.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { MHTML_MAX_BYTES } from './sources/mhtml.ts';
import { siteName } from './sources/recipe-page.ts';
import type { RecipeNoteStore } from './sources/recipe-notes.ts';
import type { RecipeStore } from './sources/recipes.ts';
import { PageError } from './sources/web-page.ts';
import {
  createPendingImports,
  createShareInbox,
  MhtmlError,
  type OfflineRead,
  type PendingImports,
  readPastedText,
  readSavedPage,
  type ShareInbox,
  sourceOf,
} from './services/recipe-imports.ts';
import { contentInputSchema, normalizeContent, type RecipeImporter } from './services/recipes.ts';
import type { Clock } from './sources/types.ts';

export type RecipesApiDeps = {
  recipes: RecipeStore;
  /** Notes de la famille sur les recettes : comptées dans le carnet, retirées avec leur recette. */
  notes: RecipeNoteStore;
  /** Absent (tests sans réseau) : l'import propose la saisie à la main. */
  importer?: RecipeImporter;
  access: Access;
  clock: Clock;
  /** Aperçus en attente d'enregistrement (texte collé, page enregistrée). */
  pending?: PendingImports;
  /** Pages enregistrées reçues par POST /partager, en attente d'être réclamées. */
  inbox?: ShareInbox;
};

/**
 * Réponse d'un import : la recette (nouvelle ou déjà au carnet), ou de quoi la saisir à la main et pourquoi.
 * `refused` : le site refuse la lecture par HomeHub ; l'écran propose alors le texte copié ou la page enregistrée.
 */
export type ImportResponse = ImportResult | { draft: RecipeDraft; reason: string; refused?: boolean };

/** Réponse d'un import par texte ou page enregistrée : la recette déjà au carnet, ou l'aperçu à corriger. */
export type OfflineImportResponse = ImportResult | ImportPreview;

export const REFUSED_REASON = 'Ce site refuse la lecture par HomeHub : copie le texte de la recette, ou partage la page enregistrée';

const importSchema = z.object({ url: z.string().trim().min(1).max(2000) });
const textSchema = z.object({
  text: z.string().trim().min(1, 'Texte de la recette attendu').max(RECIPE_TEXT_MAX, 'Texte trop long'),
  url: z.string().trim().max(2000).nullish(),
  title: z.string().trim().max(500).nullish(),
});
const sharedPageSchema = z.object({ shared: z.string().uuid() });
const createSchema = z.object({ content: contentInputSchema, url: z.string().trim().max(2000).url().nullish(), pending: z.string().max(64).nullish() });
const updateSchema = z.object({ content: contentInputSchema });

export const NOT_YOURS = 'Seul un parent, ou qui a ajouté la recette, peut la modifier';

/** Premier lien http(s) d'un texte partagé (« Regarde ça https://… »). */
export function firstLink(text: string): string | null {
  return /https?:\/\/[^\s<>"']+/iu.exec(text)?.[0].replace(/[).,;!?»]+$/u, '') ?? null;
}

export function createRecipesApi({ recipes, notes, importer, access, clock, pending = createPendingImports(), inbox = createShareInbox() }: RecipesApiDeps) {
  const api = createRouter();

  const recipeOf = async (id: string): Promise<Recipe> => (await recipes.get(id)) ?? fail(404, 'Recette inconnue');

  /** Le carnet, avec le nombre de notes ouvertes de chaque recette (pastille des cartes). */
  api.get('/recipes', async (c) => {
    const [list, open] = await Promise.all([recipes.list(), notes.openCounts()]);
    return c.json({ recipes: list.map((r) => ({ ...r, openNotes: open.get(r.id) ?? 0 })) });
  });

  api.get('/recipes/:id', async (c) => c.json(await recipeOf(c.req.param('id'))));

  api.get('/recipes/:id/photo', async (c) => {
    const photo = (await recipes.photo(c.req.param('id'))) ?? fail(404, 'Pas de photo');
    c.header('Content-Type', photo.type);
    c.header('Cache-Control', 'private, max-age=86400');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(photo.body as Uint8Array<ArrayBuffer>);
  });

  api.post('/recipes/import', async (c) => {
    const input = await readBody(c, importSchema, 'Corps attendu : { "url": "https://…" }');
    // Droit vérifié avant de lire quoi que ce soit sur le réseau.
    const author = await access.writer(c, null);
    const url = firstLink(input.url) ?? fail(400, 'Lien de recette attendu (http ou https)');
    const known = await recipes.findBySource(url);
    if (known) return c.json({ recipe: known, existing: true } satisfies ImportResponse);
    const draftOf = (title: string | null, site: string | null, reason: string): ImportResponse => ({ draft: { url, title, site }, reason });
    if (!importer) return c.json(draftOf(null, siteName(url), 'Lecture des pages indisponible'));
    let read;
    try {
      read = await importer.read(url);
    } catch (err) {
      if (!(err instanceof PageError)) throw err;
      if (err.kind === 'invalid' || err.kind === 'forbidden') return fail(400, err.message);
      if (err.kind === 'refused') return c.json({ ...draftOf(null, siteName(url), REFUSED_REASON), refused: true } satisfies ImportResponse);
      return c.json(draftOf(null, siteName(url), err.message));
    }
    if (!read.found) return c.json(draftOf(read.title, read.site, 'Aucune recette lisible sur cette page'));
    // L'adresse finale (après redirection) peut aussi être déjà au carnet.
    const again = read.url !== url ? await recipes.findBySource(read.url) : null;
    if (again) return c.json({ recipe: again, existing: true } satisfies ImportResponse);
    const source = { url: read.url, site: read.site, importedAt: clock().toISOString(), imageUrl: read.imageUrl, content: read.content };
    const recipe = await recipes.add({ ours: structuredClone(read.content), source, photo: read.photo }, author);
    return c.json({ recipe, existing: false } satisfies ImportResponse, 201);
  });

  /** Aperçu mis en attente, ou la recette déjà au carnet si la page d'origine y est. */
  async function preview(c: Context, read: OfflineRead) {
    if (read.content.ingredients.length === 0 && read.content.steps.length === 0) {
      return fail(422, read.origin === 'text' ? 'Aucun ingrédient ni étape reconnus dans ce texte' : 'Aucune recette reconnue dans cette page enregistrée');
    }
    const known = read.url ? await recipes.findBySource(read.url) : null;
    if (known) return c.json({ recipe: known, existing: true } satisfies OfflineImportResponse);
    const token = pending.put(read);
    return c.json({
      preview: { token, content: read.content, url: read.url, site: read.site, origin: read.origin, photo: read.photo !== null },
    } satisfies OfflineImportResponse);
  }

  /** Texte copié de la page (ou partagé) : découpé ici, sans rien lire sur le réseau. */
  api.post('/recipes/import-text', async (c) => {
    const input = await readBody(c, textSchema);
    await access.writer(c, null);
    return preview(c, readPastedText(input.text, { url: input.url, title: input.title }));
  });

  /**
   * Page enregistrée (.mhtml) : envoyée comme fichier (champ « page »), ou réclamée dans la boîte de réception
   * quand elle arrive par « Partager » (`{ "shared": "<numéro>" }`). Rien n'est lu sur le réseau.
   */
  api.post('/recipes/import-page', bodyLimit({ maxSize: MHTML_MAX_BYTES + 100_000, onError: () => fail(413, 'Page enregistrée trop lourde') }), async (c) => {
    await access.writer(c, null);
    let bytes: Uint8Array;
    if (/^multipart\/form-data/iu.test(c.req.header('content-type') ?? '')) {
      const form = await c.req.parseBody();
      const file = form.page;
      if (!(file instanceof File) || file.size === 0) return fail(400, 'Fichier de la page attendu (champ « page »)');
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const { shared } = await readBody(c, sharedPageSchema, 'Corps attendu : un fichier, ou { "shared": "…" }');
      bytes = inbox.take(shared)?.body ?? fail(410, 'Page partagée expirée : partage-la de nouveau');
    }
    let read: OfflineRead;
    try {
      read = readSavedPage(bytes);
    } catch (err) {
      if (err instanceof MhtmlError) return fail(400, err.message);
      throw err;
    }
    return preview(c, read);
  });

  /** Saisie à la main (rien de lisible sur la page, ou recette de famille), ou enregistrement d'un aperçu corrigé. */
  api.post('/recipes', async (c) => {
    const input = await readBody(c, createSchema, z.prettifyError);
    const author = await access.writer(c, null);
    const ours = normalizeContent(input.content);
    if (input.pending) {
      let read = pending.take(input.pending) ?? fail(410, 'Aperçu expiré : recommence l’import');
      // Lien donné à l'aperçu pour un texte collé qui n'en contenait pas.
      if (!read.url && input.url) read = { ...read, url: input.url, site: siteName(input.url) };
      return c.json(await recipes.add({ ours, source: sourceOf(read, clock().toISOString()), photo: read.photo }, author), 201);
    }
    const source = input.url ? { url: input.url, site: siteName(input.url), importedAt: clock().toISOString(), imageUrl: null, content: null } : null;
    return c.json(await recipes.add({ ours, source }, author), 201);
  });

  /** Qui modifie : un parent, ou qui a ajouté la recette. */
  const editor = (c: Context, recipe: Recipe) => access.authorOrParent(c, recipe.addedBy.ownerId, NOT_YOURS);

  api.put('/recipes/:id', async (c) => {
    const input = await readBody(c, updateSchema, z.prettifyError);
    const recipe = await recipeOf(c.req.param('id'));
    const author = await editor(c, recipe);
    return c.json((await recipes.update(recipe.id, normalizeContent(input.content), author)) ?? fail(404, 'Recette inconnue'));
  });

  /** « Relire la source » : la page est relue, les parties que notre version n'a pas modifiées en sont reprises. */
  api.post('/recipes/:id/reread', async (c) => {
    const recipe = await recipeOf(c.req.param('id'));
    const author = await editor(c, recipe);
    if (!recipe.source) return fail(400, 'Recette saisie à la main, sans page à relire');
    const url = recipe.source.url ?? fail(400, 'Recette importée depuis un texte, sans page à relire');
    if (!importer) return fail(503, 'Lecture des pages indisponible');
    let read;
    try {
      read = await importer.read(url);
    } catch (err) {
      if (!(err instanceof PageError)) throw err;
      if (err.kind === 'refused') return fail(502, REFUSED_REASON);
      return fail(err.kind === 'invalid' || err.kind === 'forbidden' ? 400 : 502, err.message);
    }
    if (!read.found) return fail(422, 'Aucune recette lisible sur cette page');
    // Relue par le serveur : la source redevient la page (plus « texte collé » ni « page enregistrée »).
    const { ours, updated, kept } = mergeReread(recipe.ours, recipe.source.content, read.content);
    const source = { url, site: read.site, importedAt: clock().toISOString(), imageUrl: read.imageUrl, content: read.content };
    const saved = (await recipes.reread(recipe.id, { source, ours, photo: read.photo }, author)) ?? fail(404, 'Recette inconnue');
    return c.json({ recipe: saved, updated, kept } satisfies RereadResult);
  });

  api.delete('/recipes/:id', async (c) => {
    await recipeOf(c.req.param('id'));
    await access.parent(c, 'Seul un parent peut retirer une recette du carnet');
    await recipes.remove(c.req.param('id'));
    // Les notes de la famille partent avec la recette.
    await notes.removeRecipe(c.req.param('id'));
    return c.body(null, 204);
  });

  return api;
}

/**
 * Cible de « Partager » (share_target du manifeste, en POST) : un lien ou un texte repart vers /partager en GET,
 * comme avant ; une page enregistrée attend dans la boîte de réception, et l'appli la réclame par l'API (le jeton du
 * téléphone n'accompagne pas cette navigation). Rien n'est lu ni exécuté ici.
 */
export function createShareRoute(inbox: ShareInbox) {
  const route = createRouter();
  route.post(
    '/partager',
    bodyLimit({ maxSize: MHTML_MAX_BYTES + 100_000, onError: (c) => c.redirect('/partager?erreur=trop-lourd', 303) }),
    async (c) => {
      const form = await c.req.parseBody().catch(() => ({}) as Record<string, string | File>);
      const params = new URLSearchParams();
      for (const key of ['title', 'text', 'url']) {
        const value = form[key];
        if (typeof value === 'string' && value.trim()) params.set(key, value.slice(0, RECIPE_TEXT_MAX));
      }
      const file = form.page;
      if (file instanceof File && file.size > 0) {
        params.set('fichier', inbox.put({ body: new Uint8Array(await file.arrayBuffer()), name: file.name.slice(0, 200), type: file.type.slice(0, 100) }));
      }
      return c.redirect(`/partager?${params}`, 303);
    },
  );
  return route;
}
