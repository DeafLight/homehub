// Routes des listes (courses, tâches) et de l'appairage des téléphones. Lecture ouverte comme le reste de l'API ;
// écriture réservée à la tablette et aux téléphones appairés ; appairage et gestion des téléphones : tablette seule,
// avec le PIN du profil quand il en a un.
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { FAMILY_ID, type Me } from '../shared/types.ts';
import { authorOf, type Caller, identify, kioskKeyMatcher } from './access.ts';
import type { ConfigStore } from './config-store.ts';
import type { DeviceStore } from './sources/devices.ts';
import { LABEL_MAX, type ListsStore } from './sources/lists.ts';
import type { PinStore } from './sources/pins.ts';

export type ListsApiDeps = { config: ConfigStore; lists: ListsStore; devices: DeviceStore; pins: PinStore; kioskKey?: string };

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
const pairingSchema = z.object({ ownerId: z.string(), pin: z.string().max(20).optional() });
const claimSchema = z.object({ code: z.string().min(1).max(100), name: z.string().trim().min(1).max(60) });

const body = async (c: Context) => c.req.json().catch(() => null);

export function createListsApi({ config, lists, devices, pins, kioskKey }: ListsApiDeps): Hono {
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

  // --- Téléphones : la tablette les appaire et les retire ---

  const kioskOnly = async (c: Context) =>
    (await caller(c)).kiosk ? null : c.json({ error: 'Réservé à la tablette de la maison' }, 403);

  /** Profils protégés par un PIN : la tablette le demande avant d'afficher leur QR code. */
  api.get('/pairing/pins', async (c) => {
    const denied = await kioskOnly(c);
    return denied ?? c.json({ protected: await pins.protectedIds() });
  });

  api.post('/pairing', async (c) => {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    const input = pairingSchema.safeParse(await body(c));
    if (!input.success || !config.current().members.some((m) => m.id === input.data.ownerId)) {
      return c.json({ error: 'Profil inconnu' }, 400);
    }
    const { ownerId, pin } = input.data;
    if ((await pins.protectedIds()).includes(ownerId)) {
      if (!pin) return c.json({ error: 'Code PIN requis' }, 403);
      const check = await pins.check(ownerId, pin);
      if (!check.ok && check.reason === 'locked') {
        const minutes = Math.max(1, Math.ceil(check.waitMs / 60_000));
        return c.json({ error: `Trop d’essais : réessaie dans ${minutes} min` }, 429);
      }
      if (!check.ok) return c.json({ error: 'Code PIN incorrect' }, 403);
    }
    return c.json(devices.createCode(ownerId), 201);
  });

  api.post('/pairing/claim', async (c) => {
    const input = claimSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Corps attendu : { "code": "…", "name": "…" }' }, 400);
    const result = await devices.claim(input.data.code, input.data.name);
    return result ? c.json(result, 201) : c.json({ error: 'Code inconnu ou expiré : afficher un nouveau QR code' }, 410);
  });

  api.get('/devices', async (c) => {
    const denied = await kioskOnly(c);
    return denied ?? c.json(await devices.list());
  });

  api.delete('/devices/:id', async (c) => {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    return (await devices.remove(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Téléphone inconnu' }, 404);
  });

  return api;
}
