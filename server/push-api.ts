// Notifications du téléphone (réglages du téléphone) : clé publique VAPID, abonnement Web Push de ce téléphone,
// désabonnement, réglages (« Pars dans 5 min », « Nouveaux mots », « Minuteurs », « Tâches en retard ») et notification d'essai. Le téléphone de la personne
// seulement (`access.ownPhone`) : l'abonnement est rattaché à l'appareil appairé, oublié s'il est retiré de la tablette.
import { z } from 'zod';
import type { PushStatus } from '../shared/types.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { type PushRecord, type PushStore, subscriptionSchema } from './sources/push.ts';
import type { PushMessage, PushResult } from './services/web-push.ts';

const prefsSchema = z.object({ trips: z.boolean(), notes: z.boolean(), timers: z.boolean(), tasks: z.boolean() }).partial().strict();

export function createPushApi({
  store,
  access,
  send,
}: {
  store: PushStore;
  access: Access;
  send: (subscription: PushRecord, message: PushMessage) => Promise<PushResult>;
}) {
  const api = createRouter();

  /** Le téléphone qui appelle : son profil et l'identifiant de l'appareil. */
  async function phone(c: Parameters<Access['ownPhone']>[0]) {
    const ownerId = await access.ownPhone(c);
    const device = (await access.caller(c)).device;
    return device ? { ownerId, deviceId: device.id } : fail(403, 'Réservé au téléphone de la personne');
  }

  /** État des notifications de ce téléphone : abonné ou non, et ses réglages. */
  const statusOf = async (deviceId: string): Promise<PushStatus> => ({
    publicKey: store.keys().publicKey,
    subscribed: (await store.get(deviceId)) !== null,
    prefs: await store.prefs(deviceId),
  });

  api.get('/push', async (c) => {
    const { deviceId } = await phone(c);
    return c.json(await statusOf(deviceId));
  });

  api.put('/push', async (c) => {
    const { ownerId, deviceId } = await phone(c);
    const subscription = await readBody(c, subscriptionSchema, 'Abonnement aux notifications illisible');
    await store.subscribe(deviceId, ownerId, subscription);
    return c.json(await statusOf(deviceId));
  });

  api.delete('/push', async (c) => {
    const { deviceId } = await phone(c);
    await store.unsubscribe(deviceId);
    return c.json(await statusOf(deviceId));
  });

  /** Réglages du téléphone : « Pars dans 5 min » (`trips`), « Nouveaux mots » (`notes`), « Minuteurs » (`timers`), « Tâches en retard » (`tasks`). */
  api.put('/push/prefs', async (c) => {
    const { deviceId } = await phone(c);
    const change = await readBody(c, prefsSchema, 'Corps attendu : { "trips"?, "notes"?, "timers"?, "tasks"? : true|false }');
    await store.setPrefs(deviceId, change);
    return c.json(await statusOf(deviceId));
  });

  api.post('/push/test', async (c) => {
    const { deviceId } = await phone(c);
    const subscription = await store.get(deviceId);
    if (!subscription) return fail(409, 'Notifications pas encore activées sur ce téléphone');
    const result = await send(subscription, { title: 'HomeHub', body: 'Les notifications marchent : trajets, mots, minuteurs et tâches en retard arriveront ici.', tag: 'essai', url: '/m/reglages' });
    if (result === 'gone') {
      await store.unsubscribe(deviceId);
      return fail(410, 'Abonnement périmé : réactive les notifications');
    }
    return result === 'sent' ? c.json({ ok: true }) : fail(502, 'Le service de notifications du téléphone ne répond pas');
  });

  return api;
}
