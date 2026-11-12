// Tests du magasin des notes sur les recettes : ajout, résolution et réouverture, texte modifié, limite par recette,
// notes retirées avec leur recette, fichier relu au redémarrage.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECIPE_NOTE_LIMITS } from '../../shared/recipe-notes.ts';
import { NOW } from '../testing.ts';
import { createRecipeNoteStore } from './recipe-notes.ts';

const TOM = { ownerId: 'tom', via: 'phone' } as const;
const ALEX = { ownerId: 'alex', via: 'tablet' } as const;

function setup() {
  let now = NOW;
  const path = join(mkdtempSync(join(tmpdir(), 'homehub-recipe-notes-')), 'recipe-notes.json');
  const clock = () => now;
  return { store: createRecipeNoteStore({ path, clock }), reopen: () => createRecipeNoteStore({ path, clock }), wait: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe('notes sur les recettes', () => {
  it('ajoutée, résolue puis rouverte, texte modifié, comptée tant qu’elle est ouverte', async () => {
    const { store, reopen, wait } = setup();
    const note = (await store.add('gratin', 'Tom n’aime pas les champignons', TOM))!;
    await store.add('crepes', 'Doubler la dose', ALEX);
    expect(note).toMatchObject({ recipeId: 'gratin', by: TOM, at: NOW.toISOString() });
    expect(Object.fromEntries(await store.openCounts())).toEqual({ gratin: 1, crepes: 1 });

    wait(60_000);
    const resolved = await store.change(note.id, { resolved: true }, ALEX);
    expect(resolved).toMatchObject({ resolvedBy: ALEX, resolvedAt: new Date(NOW.getTime() + 60_000).toISOString() });
    expect(Object.fromEntries(await store.openCounts())).toEqual({ crepes: 1 });
    // Résoudre de nouveau ne change pas qui l'a résolue.
    expect(await store.change(note.id, { resolved: true }, TOM)).toMatchObject({ resolvedBy: ALEX });

    const reopened = (await store.change(note.id, { resolved: false, text: 'Tom n’aime toujours pas les champignons' }, TOM))!;
    expect(reopened.resolvedAt).toBeUndefined();
    expect(reopened).toMatchObject({ text: 'Tom n’aime toujours pas les champignons', editedBy: TOM });
    expect(await store.change('inconnue', { resolved: true }, TOM)).toBeNull();

    // Relu depuis le disque au redémarrage.
    expect((await reopen().list('gratin')).map((n) => n.text)).toEqual(['Tom n’aime toujours pas les champignons']);
  });

  it('une recette n’a pas plus de notes que la limite', async () => {
    const { store } = setup();
    for (let i = 0; i < RECIPE_NOTE_LIMITS.perRecipe; i += 1) await store.add('gratin', `Note ${i}`, TOM);
    expect(await store.add('gratin', 'Une de trop', TOM)).toBeNull();
    expect(await store.add('crepes', 'Ailleurs, ça passe', TOM)).not.toBeNull();
  });

  it('retirées une à une, ou toutes avec leur recette', async () => {
    const { store } = setup();
    const a = (await store.add('gratin', 'A', TOM))!;
    await store.add('gratin', 'B', TOM);
    await store.add('crepes', 'C', TOM);
    expect(await store.remove(a.id)).toBe(true);
    expect(await store.remove(a.id)).toBe(false);
    expect(await store.removeRecipe('gratin')).toBe(1);
    expect(await store.list('gratin')).toEqual([]);
    expect((await store.list('crepes')).length).toBe(1);
  });
});
