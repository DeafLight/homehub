// Routes des listes (courses, tâches), des mots et de l'appairage des téléphones. Lecture ouverte comme le reste de l'API ;
// écriture réservée à la tablette et aux téléphones appairés ; appairage et gestion des téléphones : tablette seule,
// avec le PIN du profil quand il en a un (pour retirer un téléphone : ce PIN ou le code parent).
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { FAMILY_ID, type Me } from '../shared/types.ts';
import { authorOf, type Caller, identify, kioskKeyMatcher } from './access.ts';
import type { ConfigStore } from './config-store.ts';
import type { DeviceStore } from './sources/devices.ts';
import { LABEL_MAX, type ListsStore } from './sources/lists.ts';
import { NOTE_MAX, type NotesStore } from './sources/notes.ts';
import { PARENT_PIN_ID, type PinStore } from './sources/pins.ts';

export type ListsApiDeps = {
  config: ConfigStore;
  lists: ListsStore;
  notes: NotesStore;
  devices: DeviceStore;
  pins: PinStore;
  kioskKey?: string;
};

const label = z.string().trim().min(1).max(LABEL_MAX);
const by = z.string().nullish();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'jour AAAA-MM-JJ');

const shoppingSchema = z.object({ label, by });
const doneSchema = z.object({ done: z.boolean(), by });
const taskSchema = z.object({
  label,
  ownerId: z.string(),
  due: day.nullable().default(null),
  repeat: z.object({ every: z.number().int().min(1).max(365), unit: z.enum(['day', 'week']) }).nullable().default(null),
  by,
});
const noteSchema = z.object({ to: z.string(), text: z.string().trim().min(1).max(NOTE_MAX), by });
const pin = z.string().max(20).optional();
const pairingSchema = z.object({ ownerId: z.string(), pin });
const removeSchema = z.object({ pin }).nullable();
const deviceName = z.string().trim().min(1).max(60);
const claimSchema = z.object({ code: z.string().min(1).max(100), name: deviceName, system: z.string().trim().max(40).nullish() });
const renameSchema = z.object({ name: deviceName });

const body = async (c: Context) => c.req.json().catch(() => null);

export function createListsApi({ config, lists, notes, devices, pins, kioskKey }: ListsApiDeps): Hono {
  const api = new Hono();
  const ownerIds = () => [...config.current().members.map((m) => m.id), FAMILY_ID];
  const isKey = kioskKeyMatcher(kioskKey);
  const caller = (c: Context) => identify(c, devices, { addresses: config.current().kiosk.addresses, isKey });

  /** Auteur de la modification, ou la réponse d'erreur à renvoyer (401 : téléphone retiré ; 403 : lecture seule). */
  function author(c: Context, who: Caller, byId: string | null | undefined) {
    if (who.rejectedToken) return { error: c.json({ error: 'Téléphone non reconnu : à appairer de nouveau' }, 401) };
    if (byId && !ownerIds().includes(byId)) return { error: c.json({ error: 'Profil inconnu' }, 400) };
    const result = authorOf(who, byId);
    return result ? { author: result } : { error: c.json({ error: 'Lecture seule : appareil non appairé' }, 403) };
  }

  // Téléphone retiré : 401 dès l'ouverture, pas seulement à sa prochaine modification.
  api.get('/me', async (c) => {
    const { kiosk, device, rejectedToken } = await caller(c);
    if (rejectedToken) return c.json({ error: 'Téléphone non reconnu : à appairer de nouveau' }, 401);
    return c.json<Me>({ kiosk, device });
  });

  api.get('/lists', async (c) => c.json(await lists.lists()));

  api.post('/lists/shopping', async (c) => {
    const input = shoppingSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Corps attendu : { "label": "…" }' }, 400);
    const who = author(c, await caller(c), input.data.by);
    if (who.error) return who.error;
    return c.json(await lists.addShopping(input.data.label, who.author), 201);
  });

  api.put('/lists/shopping/:id', async (c) => {
    const input = doneSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Corps attendu : { "done": true|false }' }, 400);
    const who = author(c, await caller(c), input.data.by);
    if (who.error) return who.error;
    const item = await lists.setShoppingDone(c.req.param('id'), input.data.done, who.author);
    return item ? c.json(item) : c.json({ error: 'Article inconnu' }, 404);
  });

  api.delete('/lists/shopping/:id', async (c) => {
    const who = author(c, await caller(c), null);
    if (who.error) return who.error;
    return (await lists.removeShopping(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Article inconnu' }, 404);
  });

  api.post('/lists/shopping/clear', async (c) => {
    const who = author(c, await caller(c), null);
    if (who.error) return who.error;
    await lists.clearShopping();
    return c.body(null, 204);
  });

  api.post('/lists/tasks', async (c) => {
    const input = taskSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: z.prettifyError(input.error) }, 400);
    if (!ownerIds().includes(input.data.ownerId)) return c.json({ error: 'Profil inconnu' }, 400);
    const who = author(c, await caller(c), input.data.by);
    if (who.error) return who.error;
    const { label: text, ownerId, due, repeat } = input.data;
    return c.json(await lists.addTask({ label: text, ownerId, due, repeat }, who.author), 201);
  });

  api.put('/lists/tasks/:id', async (c) => {
    const input = doneSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Corps attendu : { "done": true|false }' }, 400);
    const who = author(c, await caller(c), input.data.by);
    if (who.error) return who.error;
    const task = await lists.setTaskDone(c.req.param('id'), input.data.done, who.author);
    return task ? c.json(task) : c.json({ error: 'Tâche inconnue' }, 404);
  });

  api.delete('/lists/tasks/:id', async (c) => {
    const who = author(c, await caller(c), null);
    if (who.error) return who.error;
    return (await lists.removeTask(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Tâche inconnue' }, 404);
  });

  // --- Mots : laissés par un membre (son téléphone, ou la tablette au nom du profil choisi) ---

  api.get('/notes', async (c) => c.json(await notes.list()));

  api.post('/notes', async (c) => {
    const input = noteSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: `Corps attendu : { "to": "…", "text": "…" } (${NOTE_MAX} caractères max)` }, 400);
    if (!ownerIds().includes(input.data.to)) return c.json({ error: 'Destinataire inconnu' }, 400);
    const who = author(c, await caller(c), input.data.by);
    if (who.error) return who.error;
    // Un mot est signé : sur la tablette, il faut dire qui l'écrit.
    if (!who.author.ownerId || who.author.ownerId === FAMILY_ID) return c.json({ error: 'Auteur du mot attendu' }, 400);
    return c.json(await notes.add(input.data.to, input.data.text, who.author), 201);
  });

  /** Un téléphone ne marque vus que les mots de son profil, ou ceux de toute la famille. */
  api.put('/notes/:id/seen', async (c) => {
    const input = z.object({ by }).nullable().safeParse(await body(c));
    const who = author(c, await caller(c), input.success ? input.data?.by : null);
    if (who.error) return who.error;
    const note = (await notes.list()).find((n) => n.id === c.req.param('id'));
    if (!note) return c.json({ error: 'Mot inconnu' }, 404);
    if (who.author.via === 'phone' && note.to !== who.author.ownerId && note.to !== FAMILY_ID) {
      return c.json({ error: 'Ce mot est pour quelqu’un d’autre' }, 403);
    }
    return c.json(await notes.markSeen(note.id, who.author));
  });

  // --- Téléphones : la tablette les appaire et les retire ---

  const kioskOnly = async (c: Context) =>
    (await caller(c)).kiosk ? null : c.json({ error: 'Réservé à la tablette de la maison' }, 403);

  /** Vérifie `pin` contre l'un des codes `ids` (aucun : rien à vérifier) ; renvoie la réponse d'erreur, ou null. */
  async function pinDenied(c: Context, ids: string[], pin: string | undefined) {
    if (ids.length === 0) return null;
    if (!pin) return c.json({ error: 'Code PIN requis' }, 403);
    const check = await pins.check(ids, pin);
    if (check.ok) return null;
    if (check.reason === 'locked') {
      const minutes = Math.max(1, Math.ceil(check.waitMs / 60_000));
      return c.json({ error: `Trop d’essais : réessaie dans ${minutes} min` }, 429);
    }
    return c.json({ error: 'Code PIN incorrect' }, 403);
  }

  /** Profils protégés par un PIN (la tablette le demande avant d'afficher leur QR code), et code parent défini. */
  api.get('/pairing/pins', async (c) => {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    const ids = await pins.protectedIds();
    return c.json({ protected: ids.filter((id) => id !== PARENT_PIN_ID), parent: ids.includes(PARENT_PIN_ID) });
  });

  api.post('/pairing', async (c) => {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    const input = pairingSchema.safeParse(await body(c));
    if (!input.success || !config.current().members.some((m) => m.id === input.data.ownerId)) {
      return c.json({ error: 'Profil inconnu' }, 400);
    }
    const { ownerId } = input.data;
    const protectedIds = await pins.protectedIds();
    const pinError = await pinDenied(c, protectedIds.includes(ownerId) ? [ownerId] : [], input.data.pin);
    return pinError ?? c.json(devices.createCode(ownerId), 201);
  });

  api.post('/pairing/claim', async (c) => {
    const input = claimSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Corps attendu : { "code": "…", "name": "…" }' }, 400);
    const result = await devices.claim(input.data.code, input.data.name, input.data.system ?? null);
    return result ? c.json(result, 201) : c.json({ error: 'Code inconnu ou expiré : afficher un nouveau QR code' }, 410);
  });

  api.get('/devices', async (c) => {
    const denied = await kioskOnly(c);
    return denied ?? c.json(await devices.list());
  });

  /** Nom donné sur la tablette (« Téléphone de Léa ») à la place du modèle annoncé. */
  api.patch('/devices/:id', async (c) => {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    const input = renameSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Nom attendu (60 caractères max)' }, 400);
    const device = await devices.rename(c.req.param('id'), input.data.name);
    return device ? c.json(device) : c.json({ error: 'Téléphone inconnu' }, 404);
  });

  api.delete('/devices/:id', async (c) => {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    const device = (await devices.list()).find((d) => d.id === c.req.param('id'));
    if (!device) return c.json({ error: 'Téléphone inconnu' }, 404);
    const input = removeSchema.safeParse(await body(c));
    // Le PIN du propriétaire ou le code parent, quand l'un d'eux est défini.
    const protectedIds = await pins.protectedIds();
    const ids = [device.ownerId, PARENT_PIN_ID].filter((id) => protectedIds.includes(id));
    const pinError = await pinDenied(c, ids, input.success ? input.data?.pin : undefined);
    if (pinError) return pinError;
    await devices.remove(device.id);
    return c.body(null, 204);
  });

  return api;
}
