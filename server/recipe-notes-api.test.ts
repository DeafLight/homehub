// Tests de l'API des notes sur une recette : qui en laisse (tout membre identifié, enfants compris ; un appareil non
// appairé ne fait que lire), qui les modifie, résout ou retire (leur auteur ou un parent), limites, pastille du carnet
// et notes retirées avec leur recette.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECIPE_NOTE_LIMITS, type RecipeNote } from '../shared/recipe-notes.ts';
import type { Recipe, RecipeSummary } from '../shared/recipes.ts';
import { createAccess, kioskKeyMatcher, READ_ONLY_DEVICE } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createRouter } from './http.ts';
import { createRecipeNotesApi, NOT_YOUR_NOTE } from './recipe-notes-api.ts';
import { createRecipesApi } from './recipes-api.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createRecipeNoteStore } from './sources/recipe-notes.ts';
import { createRecipeStore } from './sources/recipes.ts';
import { connectedFrom, fixedClock } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';

type CallOptions = { from?: string; token?: string; actor?: string; body?: unknown };

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
  const dir = mkdtempSync(join(tmpdir(), 'homehub-recipe-notes-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock: fixedClock });
  const sessions = createActorSessions(fixedClock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const recipes = createRecipeStore({ path: join(dir, 'recipes.json'), photosDir: join(dir, 'recipes'), clock: fixedClock });
  const notes = createRecipeNoteStore({ path: join(dir, 'recipe-notes.json'), clock: fixedClock });
  const api = createRouter();
  api.route('/', createRecipesApi({ recipes, notes, access, clock: fixedClock }));
  api.route('/', createRecipeNotesApi({ recipes, notes, access }));
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
  const alex = await phone('alex');
  const recipe = (await (await call('POST', '/recipes', { token: alex, body: { content: { title: 'Gratin', servings: 4, ingredients: [{ text: '200 g de champignons' }], steps: [{ text: 'Cuire.' }] } } })).json()) as Recipe;
  const base = `/recipes/${recipe.id}/notes`;
  const addNote = async (options: CallOptions, text: string) => call('POST', base, { ...options, body: { text } });
  return { call, phone, tablet, alex, recipe, base, addNote, notes };
}

describe('API des notes sur une recette', () => {
  it('un enfant laisse une note depuis son téléphone ; signée, datée, lisible par tous', async () => {
    const { call, phone, base, addNote } = await setup();
    const res = await addNote({ token: await phone('tom') }, '  Moins salé la prochaine fois  ');
    expect(res.status).toBe(201);
    const note = (await res.json()) as RecipeNote;
    expect(note).toMatchObject({ text: 'Moins salé la prochaine fois', by: { ownerId: 'tom', via: 'phone' }, at: fixedClock().toISOString() });
    // Lecture ouverte, même depuis un appareil non appairé.
    expect(await (await call('GET', base)).json()).toEqual({ notes: [note] });
  });

  it('à la tablette, la note est au nom de la personne reconnue ; personne devant : il faut se montrer', async () => {
    const { tablet, addNote } = await setup();
    const res = await addNote(tablet('lea'), 'Tom n’aime pas les champignons');
    expect((await res.json()).by).toEqual({ ownerId: 'lea', via: 'tablet' });
    const nobody = await addNote({ from: TABLET }, 'Sans visage');
    expect(nobody.status).toBe(403);
    expect(await nobody.json()).toMatchObject({ identify: true });
  });

  it('un appareil non appairé ne fait que lire', async () => {
    const { call, phone, base, addNote } = await setup();
    const note = (await (await addNote({ token: await phone('tom') }, 'Note de Tom')).json()) as RecipeNote;
    const add = await addNote({}, 'Anonyme');
    expect(add.status).toBe(403);
    expect((await add.json()).error).toBe(READ_ONLY_DEVICE);
    expect((await call('PATCH', `${base}/${note.id}`, { body: { resolved: true } })).status).toBe(403);
    expect((await call('DELETE', `${base}/${note.id}`)).status).toBe(403);
  });

  it('un enfant modifie, résout et retire ses notes, pas celles des autres', async () => {
    const { call, phone, base, addNote } = await setup();
    const tom = await phone('tom');
    const lea = await phone('lea');
    const mine = (await (await addNote({ token: tom }, 'Plus de fromage')).json()) as RecipeNote;
    const hers = (await (await addNote({ token: lea }, 'Sans champignons pour Tom')).json()) as RecipeNote;

    const edited = await call('PATCH', `${base}/${mine.id}`, { token: tom, body: { text: 'Beaucoup plus de fromage' } });
    expect(await edited.json()).toMatchObject({ text: 'Beaucoup plus de fromage', editedBy: { ownerId: 'tom' } });
    expect(await (await call('PATCH', `${base}/${mine.id}`, { token: tom, body: { resolved: true } })).json()).toMatchObject({ resolvedBy: { ownerId: 'tom' } });

    for (const [method, body] of [['PATCH', { resolved: true }], ['PATCH', { text: 'Avec champignons' }], ['DELETE', undefined]] as const) {
      const res = await call(method, `${base}/${hers.id}`, { token: tom, body });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(NOT_YOUR_NOTE);
    }
    expect((await call('DELETE', `${base}/${mine.id}`, { token: tom })).status).toBe(204);
    expect(((await (await call('GET', base)).json()).notes as RecipeNote[]).map((n) => n.id)).toEqual([hers.id]);
  });

  it('un parent résout, rouvre, modifie ou retire la note d’un enfant (téléphone ou tablette)', async () => {
    const { call, phone, tablet, alex, base, addNote } = await setup();
    const note = (await (await addNote({ token: await phone('lea') }, 'Cuire 5 minutes de plus')).json()) as RecipeNote;
    expect(await (await call('PATCH', `${base}/${note.id}`, { ...tablet('sam'), body: { resolved: true } })).json()).toMatchObject({ resolvedBy: { ownerId: 'sam', via: 'tablet' } });
    const reopened = (await (await call('PATCH', `${base}/${note.id}`, { token: alex, body: { resolved: false } })).json()) as RecipeNote;
    expect(reopened.resolvedAt).toBeUndefined();
    expect((await call('DELETE', `${base}/${note.id}`, { token: alex })).status).toBe(204);
  });

  it('note vide, trop longue, modification sans rien, note ou recette inconnue', async () => {
    const { call, alex, base, addNote, recipe } = await setup();
    expect((await addNote({ token: alex }, ' \n ')).status).toBe(400);
    expect((await addNote({ token: alex }, 'x'.repeat(RECIPE_NOTE_LIMITS.text + 1))).status).toBe(400);
    const note = (await (await addNote({ token: alex }, 'x'.repeat(RECIPE_NOTE_LIMITS.text))).json()) as RecipeNote;
    expect((await call('PATCH', `${base}/${note.id}`, { token: alex, body: {} })).status).toBe(400);
    expect((await call('PATCH', `${base}/inconnue`, { token: alex, body: { resolved: true } })).status).toBe(404);
    expect((await call('GET', '/recipes/inconnue/notes')).status).toBe(404);
    expect((await call('POST', '/recipes/inconnue/notes', { token: alex, body: { text: 'Perdue' } })).status).toBe(404);
    // Une note se désigne avec sa recette.
    const other = (await (await call('POST', '/recipes', { token: alex, body: { content: { title: 'Crêpes', servings: 4 } } })).json()) as Recipe;
    expect((await call('DELETE', `/recipes/${other.id}/notes/${note.id}`, { token: alex })).status).toBe(404);
    expect(recipe.id).not.toBe(other.id);
  });

  it('au-delà du maximum de notes sur une recette : refus clair', async () => {
    const { alex, addNote, notes, recipe } = await setup();
    for (let i = 0; i < RECIPE_NOTE_LIMITS.perRecipe; i += 1) await notes.add(recipe.id, `Note ${i}`, { ownerId: 'alex', via: 'phone' });
    expect((await addNote({ token: alex }, 'Une de trop')).status).toBe(409);
  });

  it('le carnet compte les notes ouvertes ; retirer la recette retire ses notes', async () => {
    const { call, alex, base, addNote, recipe, notes } = await setup();
    const first = (await (await addNote({ token: alex }, 'Doubler l’ail')).json()) as RecipeNote;
    await addNote({ token: alex }, 'Four à 200 °C');
    await call('PATCH', `${base}/${first.id}`, { token: alex, body: { resolved: true } });
    const { recipes } = (await (await call('GET', '/recipes')).json()) as { recipes: RecipeSummary[] };
    expect(recipes).toEqual([expect.objectContaining({ id: recipe.id, openNotes: 1 })]);

    expect((await call('DELETE', `/recipes/${recipe.id}`, { token: alex })).status).toBe(204);
    expect(await notes.list(recipe.id)).toEqual([]);
  });
});
