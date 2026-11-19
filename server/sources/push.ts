// Notifications Web Push (« Pars dans 5 min », « Nouveaux mots », « Minuteurs », « Tâches en retard ») : clés VAPID du serveur, générées au premier
// démarrage et gardées dans push-vapid.json (dossier d'état, jamais dans le dépôt) ; abonnements des téléphones appairés
// dans push.json, un par téléphone (identifiant de l'appareil), avec ce qui a déjà été annoncé (trajets, minuteurs,
// tâches en retard : une seule notification chacun, même après un redémarrage), oubliés au bout de deux jours. Les réglages de chaque téléphone (quelles
// notifications il veut) sont gardés à part de l'abonnement : ils survivent à « Couper » puis « Activer ».
import { z } from 'zod';
import { DEFAULT_PUSH_PREFS, type PushPrefs } from '../../shared/types.ts';
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
  /** Déjà annoncé (trajets, minuteurs, tâches en retard) : clé → heure d'envoi. */
  sent: z.record(z.string(), z.string()),
  /** Réglages par téléphone ; absents : tout activé (fichiers d'avant les réglages compris). */
  prefs: z.record(z.string(), z.object({ trips: z.boolean(), notes: z.boolean(), timers: z.boolean(), tasks: z.boolean() }).partial()).default({}),
});
type PushFile = z.infer<typeof fileSchema>;

export type PushRecord = PushSubscriptionJson & { deviceId: string; ownerId: string; prefs: PushPrefs };

export type PushStore = {
  /** Lit les clés VAPID, ou les génère et les enregistre la première fois. */
  load(): Promise<void>;
  keys(): VapidKeys;
  get(deviceId: string): Promise<PushRecord | null>;
  all(): Promise<PushRecord[]>;
  subscribe(deviceId: string, ownerId: string, subscription: PushSubscriptionJson): Promise<void>;
  unsubscribe(deviceId: string): Promise<void>;
  /** Réglages du téléphone (tout activé tant qu'il n'a rien choisi). */
  prefs(deviceId: string): Promise<PushPrefs>;
  /** Change une partie des réglages du téléphone ; renvoie les réglages complets. */
  setPrefs(deviceId: string, change: Partial<PushPrefs>): Promise<PushPrefs>;
  /** Marque une clé annoncée (trajet, minuteur, tâche) ; faux si elle l'était déjà (pas de seconde notification). */
  markSent(key: string): Promise<boolean>;
};

export function createPushStore({ path, keysPath, clock }: { path: string; keysPath: string; clock: Clock }): PushStore {
  const keyFile = createJsonFile({ path: keysPath, schema: keysSchema.nullable(), initial: () => null });
  const state = createJsonFile<PushFile>({
    path,
    schema: fileSchema,
    initial: () => ({ version: 1, subscriptions: {}, sent: {}, prefs: {} }),
    beforeSave: (file) => {
      const now = clock().getTime();
      for (const [key, at] of Object.entries(file.sent)) if (now - Date.parse(at) > SENT_KEEP_MS) delete file.sent[key];
    },
  });
  let vapid: VapidKeys | null = null;
  const prefsOf = (file: PushFile, deviceId: string): PushPrefs => ({ ...DEFAULT_PUSH_PREFS, ...file.prefs[deviceId] });
  const record = (file: PushFile, deviceId: string, s: PushFile['subscriptions'][string]): PushRecord => ({
    deviceId,
    ownerId: s.ownerId,
    endpoint: s.endpoint,
    keys: s.keys,
    prefs: prefsOf(file, deviceId),
  });

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
      const file = await state.read();
      const s = file.subscriptions[deviceId];
      return s ? record(file, deviceId, s) : null;
    },

    async all() {
      const file = await state.read();
      return Object.entries(file.subscriptions).map(([id, s]) => record(file, id, s));
    },

    async prefs(deviceId) {
      return prefsOf(await state.read(), deviceId);
    },

    setPrefs(deviceId, change) {
      return state.update((file) => {
        file.prefs[deviceId] = { ...prefsOf(file, deviceId), ...change };
        return prefsOf(file, deviceId);
      });
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
