// Notifications Web Push (« Pars dans 5 min ») : clés VAPID du serveur, générées au premier démarrage et gardées dans
// push-vapid.json (dossier d'état, jamais dans le dépôt) ; abonnements des téléphones appairés dans push.json, un par
// téléphone (identifiant de l'appareil), avec les trajets déjà annoncés (une seule notification par trajet, même après
// un redémarrage), oubliés au bout de deux jours.
import { z } from 'zod';
import { generateVapidKeys, type PushSubscriptionJson, type VapidKeys } from '../services/web-push.ts';
import { createJsonFile } from './json-file.ts';
import type { Clock } from './types.ts';

const SENT_KEEP_MS = 2 * 24 * 3_600_000;

const keysSchema = z.object({ version: z.literal(1), publicKey: z.string().min(80), privateKey: z.string().min(40), createdAt: z.string() });

export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'adresse de push en https attendue'),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/u), auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/u) }),
});

const fileSchema = z.object({
  version: z.literal(1),
  subscriptions: z.record(z.string(), subscriptionSchema.extend({ ownerId: z.string(), at: z.string() })),
  /** Trajets déjà annoncés : clé → heure d'envoi. */
  sent: z.record(z.string(), z.string()),
});
type PushFile = z.infer<typeof fileSchema>;

export type PushRecord = PushSubscriptionJson & { deviceId: string; ownerId: string };

export type PushStore = {
  /** Lit les clés VAPID, ou les génère et les enregistre la première fois. */
  load(): Promise<void>;
  keys(): VapidKeys;
  get(deviceId: string): Promise<PushRecord | null>;
  all(): Promise<PushRecord[]>;
  subscribe(deviceId: string, ownerId: string, subscription: PushSubscriptionJson): Promise<void>;
  unsubscribe(deviceId: string): Promise<void>;
  /** Marque un trajet annoncé ; faux s'il l'était déjà (pas de seconde notification). */
  markSent(key: string): Promise<boolean>;
};

export function createPushStore({ path, keysPath, clock }: { path: string; keysPath: string; clock: Clock }): PushStore {
  const keyFile = createJsonFile({ path: keysPath, schema: keysSchema.nullable(), initial: () => null });
  const state = createJsonFile<PushFile>({
    path,
    schema: fileSchema,
    initial: () => ({ version: 1, subscriptions: {}, sent: {} }),
    beforeSave: (file) => {
      const now = clock().getTime();
      for (const [key, at] of Object.entries(file.sent)) if (now - Date.parse(at) > SENT_KEEP_MS) delete file.sent[key];
    },
  });
  let vapid: VapidKeys | null = null;
  const record = (deviceId: string, s: PushFile['subscriptions'][string]): PushRecord => ({ deviceId, ownerId: s.ownerId, endpoint: s.endpoint, keys: s.keys });

  return {
    async load() {
      const stored = await keyFile.read();
      if (stored) {
        vapid = { publicKey: stored.publicKey, privateKey: stored.privateKey };
        return;
      }
      vapid = generateVapidKeys();
      await keyFile.replace({ version: 1, ...vapid, createdAt: clock().toISOString() });
    },

    keys() {
      if (!vapid) throw new Error('Clés VAPID pas encore lues');
      return vapid;
    },

    async get(deviceId) {
      const s = (await state.read()).subscriptions[deviceId];
      return s ? record(deviceId, s) : null;
    },

    async all() {
      return Object.entries((await state.read()).subscriptions).map(([id, s]) => record(id, s));
    },

    async subscribe(deviceId, ownerId, { endpoint, keys }) {
      await state.update((file) => {
        file.subscriptions[deviceId] = { ownerId, endpoint, keys, at: clock().toISOString() };
      });
    },

    async unsubscribe(deviceId) {
      await state.update(
        (file) => {
          const had = deviceId in file.subscriptions;
          delete file.subscriptions[deviceId];
          return had;
        },
        (had) => had,
      );
    },

    markSent(key) {
      return state.update(
        (file) => {
          if (key in file.sent) return false;
          file.sent[key] = clock().toISOString();
          return true;
        },
        (fresh) => fresh,
      );
    },
  };
}
