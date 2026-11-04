// Routes des listes (courses, tâches), des mots, des visages et de l'appairage des téléphones. Lecture ouverte comme le
// reste de l'API ; écriture : téléphones appairés (pour leur profil) et tablette (pour la personne reconnue), un parent
// partout (famille comprise), un enfant sur son profil seulement. Appairage et téléphones : tablette seule, personne
// reconnue qui a ce droit sur le profil, et le PIN du profil quand il en a un (pour retirer un téléphone : ce PIN ou le
// code parent). Visages : tablette seule et code parent (personne n'est encore reconnu au premier enregistrement).
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { FAMILY_ID, type Me } from '../shared/types.ts';
import { type Access, ACTOR_HEADER } from './access.ts';
import type { ConfigStore } from './config-store.ts';
import type { DeviceStore } from './sources/devices.ts';
import {
  type ActorSessions,
  embeddingSchema,
  type FaceStore,
  type FaceVerdict,
  judge,
  MAX_SAMPLES,
  worthLearning,
} from './sources/faces.ts';
import { LABEL_MAX, type ListsStore } from './sources/lists.ts';
import { NOTE_MAX, type NotesStore } from './sources/notes.ts';
import { PARENT_PIN_ID, type PinStore } from './sources/pins.ts';

export type ListsApiDeps = {
  config: ConfigStore;
  lists: ListsStore;
  notes: NotesStore;
  devices: DeviceStore;
  pins: PinStore;
  faces: FaceStore;
  sessions: ActorSessions;
  access: Access;
};

const label = z.string().trim().min(1).max(LABEL_MAX);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'jour AAAA-MM-JJ');

const shoppingSchema = z.object({ label });
const doneSchema = z.object({ done: z.boolean() });
const taskSchema = z.object({
  label,
  ownerId: z.string(),
  due: day.nullable().default(null),
  repeat: z.object({ every: z.number().int().min(1).max(365), unit: z.enum(['day', 'week']) }).nullable().default(null),
});
/** `from` : profil ouvert sur la tablette (sur un téléphone, son profil, quoi qu'il annonce). */
const noteSchema = z.object({ to: z.string(), from: z.string().nullish(), text: z.string().trim().min(1).max(NOTE_MAX) });
const pin = z.string().max(20).optional();
const pairingSchema = z.object({ ownerId: z.string(), pin });
const removeSchema = z.object({ pin }).nullable();
const deviceName = z.string().trim().min(1).max(60);
const claimSchema = z.object({ code: z.string().min(1).max(100), name: deviceName, system: z.string().trim().max(40).nullish() });
const renameSchema = z.object({ name: deviceName });
const score = z.number().min(0).max(1);
const identifySchema = z.object({ embedding: embeddingSchema, real: score, live: score });
const enrollSchema = z.object({ embeddings: z.array(embeddingSchema).min(1).max(MAX_SAMPLES), pin });

const body = async (c: Context) => c.req.json().catch(() => null);

export function createListsApi({ config, lists, notes, devices, pins, faces, sessions, access }: ListsApiDeps): Hono {
  const api = new Hono();
  const ownerIds = () => [...config.current().members.map((m) => m.id), FAMILY_ID];
  const caller = access.caller;

  /**
   * Auteur de la modification sur le profil `target`, ou la réponse d'erreur (401 : téléphone retiré ; 403 : lecture
   * seule, avec `identify` quand la tablette doit d'abord reconnaître quelqu'un).
   */
  async function author(c: Context, target: string | null) {
    const who = await access.write(c, target);
    return 'author' in who ? who : { error: c.json({ error: who.error, identify: who.identify }, who.status) };
  }

  /** Profil d'une tâche des listes (tâche inconnue : null). */
  const taskOwner = async (id: string) => (await lists.lists()).tasks.find((t) => t.id === id)?.ownerId ?? null;

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
    const who = await author(c, FAMILY_ID);
    if ('error' in who) return who.error;
    return c.json(await lists.addShopping(input.data.label, who.author), 201);
  });

  api.put('/lists/shopping/:id', async (c) => {
    const input = doneSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Corps attendu : { "done": true|false }' }, 400);
    const who = await author(c, FAMILY_ID);
    if ('error' in who) return who.error;
    const item = await lists.setShoppingDone(c.req.param('id'), input.data.done, who.author);
    return item ? c.json(item) : c.json({ error: 'Article inconnu' }, 404);
  });

  api.delete('/lists/shopping/:id', async (c) => {
    const who = await author(c, FAMILY_ID);
    if ('error' in who) return who.error;
    return (await lists.removeShopping(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Article inconnu' }, 404);
  });

  api.post('/lists/shopping/clear', async (c) => {
    const who = await author(c, FAMILY_ID);
    if ('error' in who) return who.error;
    await lists.clearShopping();
    return c.body(null, 204);
  });

  api.post('/lists/tasks', async (c) => {
    const input = taskSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: z.prettifyError(input.error) }, 400);
    if (!ownerIds().includes(input.data.ownerId)) return c.json({ error: 'Profil inconnu' }, 400);
    const who = await author(c, input.data.ownerId);
    if ('error' in who) return who.error;
    const { label: text, ownerId, due, repeat } = input.data;
    return c.json(await lists.addTask({ label: text, ownerId, due, repeat }, who.author), 201);
  });

  api.put('/lists/tasks/:id', async (c) => {
    const input = doneSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Corps attendu : { "done": true|false }' }, 400);
    const owner = await taskOwner(c.req.param('id'));
    if (!owner) return c.json({ error: 'Tâche inconnue' }, 404);
    const who = await author(c, owner);
    if ('error' in who) return who.error;
    const task = await lists.setTaskDone(c.req.param('id'), input.data.done, who.author);
    return task ? c.json(task) : c.json({ error: 'Tâche inconnue' }, 404);
  });

  api.delete('/lists/tasks/:id', async (c) => {
    const owner = await taskOwner(c.req.param('id'));
    if (!owner) return c.json({ error: 'Tâche inconnue' }, 404);
    const who = await author(c, owner);
    if ('error' in who) return who.error;
    return (await lists.removeTask(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Tâche inconnue' }, 404);
  });

  // --- Mots : envoyés depuis un profil (celui du téléphone, ou celui ouvert sur la tablette), à un autre ---

  api.get('/notes', async (c) => c.json(await notes.list()));

  api.post('/notes', async (c) => {
    const input = noteSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: `Corps attendu : { "to": "…", "text": "…" } (${NOTE_MAX} caractères max)` }, 400);
    const { to, text } = input.data;
    const { device } = await caller(c);
    const from = device?.ownerId ?? input.data.from;
    if (!from || !ownerIds().includes(from)) return c.json({ error: 'Profil d’envoi attendu' }, 400);
    if (!ownerIds().includes(to)) return c.json({ error: 'Destinataire inconnu' }, 400);
    if (to === from) return c.json({ error: 'Un mot va à un autre profil' }, 400);
    const who = await author(c, from);
    if ('error' in who) return who.error;
    return c.json(await notes.add(to, text, { ownerId: from, via: who.author.via }), 201);
  });

  /** Marquer « Vu » : droit d'écriture sur le destinataire (un mot à toute la famille : un parent). */
  api.put('/notes/:id/seen', async (c) => {
    const note = (await notes.list()).find((n) => n.id === c.req.param('id'));
    if (!note) return c.json({ error: 'Mot inconnu' }, 404);
    const who = await author(c, note.to);
    if ('error' in who) return who.error;
    return c.json(await notes.markSeen(note.id, who.author));
  });

  // --- Téléphones : la tablette les appaire et les retire ---

  const kioskOnly = async (c: Context) =>
    (await caller(c)).kiosk ? null : c.json({ error: 'Réservé à la tablette de la maison' }, 403);

  /** Tablette, et personne reconnue qui peut écrire sur `ownerId` : sinon la réponse d'erreur. */
  async function kioskWriteDenied(c: Context, ownerId: string) {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    const who = await author(c, ownerId);
    return 'error' in who ? who.error : null;
  }

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

  /** Relier un téléphone donne le droit d'écrire sur son profil : il faut soi-même ce droit. */
  api.post('/pairing', async (c) => {
    const kiosk = await kioskOnly(c);
    if (kiosk) return kiosk;
    const input = pairingSchema.safeParse(await body(c));
    if (!input.success || !config.current().members.some((m) => m.id === input.data.ownerId)) {
      return c.json({ error: 'Profil inconnu' }, 400);
    }
    const { ownerId } = input.data;
    const denied = await kioskWriteDenied(c, ownerId);
    if (denied) return denied;
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
    const kiosk = await kioskOnly(c);
    if (kiosk) return kiosk;
    const found = (await devices.list()).find((d) => d.id === c.req.param('id'));
    if (!found) return c.json({ error: 'Téléphone inconnu' }, 404);
    const denied = await kioskWriteDenied(c, found.ownerId);
    if (denied) return denied;
    const input = renameSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Nom attendu (60 caractères max)' }, 400);
    const device = await devices.rename(found.id, input.data.name);
    return device ? c.json(device) : c.json({ error: 'Téléphone inconnu' }, 404);
  });

  // --- Visages : enregistrés avec le code parent ; reconnus pour savoir qui écrit sur la tablette ---

  api.get('/faces', async (c) => {
    const denied = await kioskOnly(c);
    return denied ?? c.json({ enrolled: await faces.enrolled(), samples: await faces.counts() });
  });

  /** Juge une analyse de la tablette, sur les membres actuels seulement (un profil retiré n'est plus reconnu). */
  async function verdictOf(reading: z.infer<typeof identifySchema>) {
    const members = new Set(config.current().members.map((m) => m.id));
    const scores = (await faces.scores(reading.embedding)).filter((s) => members.has(s.ownerId));
    return { scores, verdict: judge(reading, scores, config.current().faces) };
  }

  const describe = ({ result, ownerId, score, next }: FaceVerdict, { real, live }: { real: number; live: number }) =>
    `${result} : ${ownerId ?? '-'} ${score}, suivant ${next}, real=${real} live=${live}`;

  /** Dernière empreinte apprise, par personne. */
  const lastLearned = new Map<string, number>();

  /** Journal des visages : chaque reconnaissance nouvelle, et un refus toutes les 10 s au plus (la tablette en envoie un par seconde). */
  let lastRejectLog = 0;
  const logReject = (message: string) => {
    if (Date.now() - lastRejectLog < 10_000) return;
    lastRejectLog = Date.now();
    console.info(`visages : ${message}`);
  };

  /**
   * La tablette envoie, environ une fois par seconde, l'empreinte du visage qu'elle voit et ses scores contre une photo
   * (`real`) ou un écran (`live`). Reconnu : une session, présentée ensuite dans l'en-tête X-Actor-Session ; la même,
   * prolongée, tant que c'est la même personne.
   */
  api.post('/faces/identify', async (c) => {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    const input = identifySchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Empreinte de visage attendue' }, 400);
    const rules = config.current().faces;
    const { verdict } = await verdictOf(input.data);
    if (verdict.result !== 'ok' || !verdict.ownerId) {
      logReject(`non reconnu, ${describe(verdict, input.data)}`);
      const far = verdict.result === 'photo' || verdict.result === 'screen';
      return c.json({ error: far ? 'Visage non reconnu : approche-toi de la tablette' : 'Visage non reconnu' }, 401);
    }
    const ownerId = verdict.ownerId;
    const now = Date.now();
    if (rules.learnMinutes > 0 && worthLearning(verdict, rules) && now - (lastLearned.get(ownerId) ?? 0) >= rules.learnMinutes * 60_000) {
      lastLearned.set(ownerId, now);
      await faces.learn(ownerId, input.data.embedding);
      console.info(`visages : empreinte apprise, ${describe(verdict, input.data)}`);
    }
    const presented = c.req.header(ACTOR_HEADER);
    if (presented && sessions.get(presented, rules.sessionMinutes) === ownerId) {
      return c.json({ ownerId, token: presented });
    }
    sessions.close(presented);
    console.info(`visages : reconnu, ${describe(verdict, input.data)}`);
    return c.json({ ownerId, ...sessions.open(ownerId, rules.sessionMinutes) });
  });

  /**
   * Diagnostic (page Visages) : le verdict d'une analyse et la ressemblance avec chaque personne, avec les seuils en
   * vigueur ; n'ouvre aucune session et n'apprend rien.
   */
  api.post('/faces/diagnose', async (c) => {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    const input = identifySchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Empreinte de visage attendue' }, 400);
    const { threshold, margin, antispoof, liveness } = config.current().faces;
    return c.json({ ...(await verdictOf(input.data)), rules: { threshold, margin, antispoof, liveness } });
  });

  api.delete('/faces/session', (c) => {
    sessions.close(c.req.header(ACTOR_HEADER));
    return c.body(null, 204);
  });

  /** Enregistrer ou retirer un visage : code parent obligatoire (sans lui, n'importe qui pourrait se faire passer pour un parent). */
  async function parentDenied(c: Context, pin: string | undefined) {
    if (!(await pins.protectedIds()).includes(PARENT_PIN_ID)) return c.json({ error: 'Définis d’abord le code parent' }, 403);
    return pinDenied(c, [PARENT_PIN_ID], pin);
  }

  api.post('/faces/:ownerId', async (c) => {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    const ownerId = c.req.param('ownerId');
    if (!config.current().members.some((m) => m.id === ownerId)) return c.json({ error: 'Profil inconnu' }, 400);
    const input = enrollSchema.safeParse(await body(c));
    if (!input.success) return c.json({ error: 'Empreintes de visage attendues' }, 400);
    const pinError = await parentDenied(c, input.data.pin);
    if (pinError) return pinError;
    await faces.enroll(ownerId, input.data.embeddings);
    return c.body(null, 204);
  });

  api.delete('/faces/:ownerId', async (c) => {
    const denied = await kioskOnly(c);
    if (denied) return denied;
    const input = removeSchema.safeParse(await body(c));
    const pinError = await parentDenied(c, input.success ? input.data?.pin : undefined);
    if (pinError) return pinError;
    return (await faces.remove(c.req.param('ownerId'))) ? c.body(null, 204) : c.json({ error: 'Visage inconnu' }, 404);
  });

  api.delete('/devices/:id', async (c) => {
    const kiosk = await kioskOnly(c);
    if (kiosk) return kiosk;
    const device = (await devices.list()).find((d) => d.id === c.req.param('id'));
    if (!device) return c.json({ error: 'Téléphone inconnu' }, 404);
    const denied = await kioskWriteDenied(c, device.ownerId);
    if (denied) return denied;
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
