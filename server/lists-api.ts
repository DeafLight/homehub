// Routes des listes (courses, tâches) et des mots. Lecture ouverte comme le reste de l'API ; écriture : téléphones
// appairés (pour leur profil) et tablette (pour la personne reconnue), un parent partout (famille comprise), un enfant
// sur son profil seulement.
import { z } from 'zod';
import { FAMILY_ID } from '../shared/types.ts';
import type { Access } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { LABEL_MAX, type ListsStore } from './sources/lists.ts';
import { NOTE_MAX, type NotesStore } from './sources/notes.ts';

export type ListsApiDeps = {
  household: Household;
  lists: ListsStore;
  notes: NotesStore;
  access: Access;
};

const label = z.string().trim().min(1).max(LABEL_MAX);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'jour AAAA-MM-JJ');

const shoppingSchema = z.object({ label });
const doneSchema = z.object({ done: z.boolean() });
const DONE_EXPECTED = 'Corps attendu : { "done": true|false }';
const taskSchema = z.object({
  label,
  ownerId: z.string(),
  due: day.nullable().default(null),
  repeat: z.object({ every: z.number().int().min(1).max(365), unit: z.enum(['day', 'week']) }).nullable().default(null),
});
/** `from` : profil ouvert sur la tablette (sur un téléphone, son profil, quoi qu'il annonce). */
const noteSchema = z.object({ to: z.string(), from: z.string().nullish(), text: z.string().trim().min(1).max(NOTE_MAX) });

export function createListsApi({ household, lists, notes, access }: ListsApiDeps) {
  const api = createRouter();

  /** Profil d'une tâche des listes ; tâche inconnue : 404. */
  const taskOwner = async (id: string) => (await lists.lists()).tasks.find((t) => t.id === id)?.ownerId ?? fail(404, 'Tâche inconnue');

  api.get('/lists', async (c) => c.json(await lists.lists()));

  api.post('/lists/shopping', async (c) => {
    const input = await readBody(c, shoppingSchema, 'Corps attendu : { "label": "…" }');
    const author = await access.writer(c, FAMILY_ID);
    return c.json(await lists.addShopping(input.label, author), 201);
  });

  api.put('/lists/shopping/:id', async (c) => {
    const { done } = await readBody(c, doneSchema, DONE_EXPECTED);
    const author = await access.writer(c, FAMILY_ID);
    return c.json((await lists.setShoppingDone(c.req.param('id'), done, author)) ?? fail(404, 'Article inconnu'));
  });

  api.delete('/lists/shopping/:id', async (c) => {
    await access.writer(c, FAMILY_ID);
    return (await lists.removeShopping(c.req.param('id'))) ? c.body(null, 204) : fail(404, 'Article inconnu');
  });

  api.post('/lists/shopping/clear', async (c) => {
    await access.writer(c, FAMILY_ID);
    await lists.clearShopping();
    return c.body(null, 204);
  });

  api.post('/lists/tasks', async (c) => {
    const { label: text, ownerId, due, repeat } = await readBody(c, taskSchema, z.prettifyError);
    if (!household.isOwner(ownerId)) return fail(400, 'Profil inconnu');
    const author = await access.writer(c, ownerId);
    return c.json(await lists.addTask({ label: text, ownerId, due, repeat }, author), 201);
  });

  api.put('/lists/tasks/:id', async (c) => {
    const { done } = await readBody(c, doneSchema, DONE_EXPECTED);
    const author = await access.writer(c, await taskOwner(c.req.param('id')));
    return c.json((await lists.setTaskDone(c.req.param('id'), done, author)) ?? fail(404, 'Tâche inconnue'));
  });

  api.delete('/lists/tasks/:id', async (c) => {
    await access.writer(c, await taskOwner(c.req.param('id')));
    return (await lists.removeTask(c.req.param('id'))) ? c.body(null, 204) : fail(404, 'Tâche inconnue');
  });

  // --- Mots : envoyés depuis un profil (celui du téléphone, ou celui ouvert sur la tablette), à un autre ---

  api.get('/notes', async (c) => c.json(await notes.list()));

  api.post('/notes', async (c) => {
    const input = await readBody(c, noteSchema, `Corps attendu : { "to": "…", "text": "…" } (${NOTE_MAX} caractères max)`);
    const { device } = await access.caller(c);
    const from = device?.ownerId ?? input.from;
    if (!from || !household.isOwner(from)) return fail(400, 'Profil d’envoi attendu');
    if (!household.isOwner(input.to)) return fail(400, 'Destinataire inconnu');
    if (input.to === from) return fail(400, 'Un mot va à un autre profil');
    const author = await access.writer(c, from);
    return c.json(await notes.add(input.to, input.text, { ownerId: from, via: author.via }), 201);
  });

  /** Marquer « Vu » : droit d'écriture sur le destinataire (un mot à toute la famille : un parent). */
  api.put('/notes/:id/seen', async (c) => {
    const note = (await notes.list()).find((n) => n.id === c.req.param('id')) ?? fail(404, 'Mot inconnu');
    const author = await access.writer(c, note.to);
    return c.json(await notes.markSeen(note.id, author));
  });

  return api;
}
