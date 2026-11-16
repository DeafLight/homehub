// Notifications du téléphone (réglages du téléphone) : clé publique VAPID, abonnement Web Push de ce téléphone,
// désabonnement et notification d'essai. Le téléphone de la personne seulement (`access.ownPhone`) : l'abonnement est
// rattaché à l'appareil appairé, oublié s'il est retiré depuis la tablette.
import type { PushStatus } from '../shared/types.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { type PushRecord, type PushStore, subscriptionSchema } from './sources/push.ts';
import type { PushMessage, PushResult } from './services/web-push.ts';

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

  api.get('/push', async (c) => {
    const { deviceId } = await phone(c);
    const status: PushStatus = { publicKey: store.keys().publicKey, subscribed: (await store.get(deviceId)) !== null };
    return c.json(status);
  });

  api.put('/push', async (c) => {
    const { ownerId, deviceId } = await phone(c);
    const subscription = await readBody(c, subscriptionSchema, 'Abonnement aux notifications illisible');
    await store.subscribe(deviceId, ownerId, subscription);
    return c.json({ publicKey: store.keys().publicKey, subscribed: true } satisfies PushStatus);
  });

  api.delete('/push', async (c) => {
    const { deviceId } = await phone(c);
    await store.unsubscribe(deviceId);
    return c.json({ publicKey: store.keys().publicKey, subscribed: false } satisfies PushStatus);
  });

  api.post('/push/test', async (c) => {
    const { deviceId } = await phone(c);
    const subscription = await store.get(deviceId);
    if (!subscription) return fail(409, 'Notifications pas encore activées sur ce téléphone');
    const result = await send(subscription, { title: 'HomeHub', body: 'Les notifications marchent : « Pars dans 5 min » arrivera ici.', tag: 'essai', url: '/m/reglages' });
    if (result === 'gone') {
      await store.unsubscribe(deviceId);
      return fail(410, 'Abonnement périmé : réactive les notifications');
    }
    return result === 'sent' ? c.json({ ok: true }) : fail(502, 'Le service de notifications du téléphone ne répond pas');
  });

  return api;
}
