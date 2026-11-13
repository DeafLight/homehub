// Routes de l'appli HomeHub TV (télé appairée) et de sa gestion. La télé : demande d'appairage (sans jeton, elle n'en a
// pas encore), puis, avec son jeton, ses événements (interrogation longue), ses comptes rendus et le téléchargement des
// messages vocaux. La tablette : liste, appairage (code affiché sur la télé), nom, retrait, par un parent reconnu. Le
// téléphone d'un parent : les télés où envoyer sa voix, et l'envoi (mêmes règles que vers un appareil Cast).
import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { z } from 'zod';
import { SCREEN_PROTOCOL, SCREEN_PROTOCOL_HEADER, type Screen, type ScreenTarget } from '../shared/screen.ts';
import type { Access } from './access.ts';
import { VOICE_OFF, VOICE_PARENTS_ONLY, VOICE_PHONE_ONLY } from './cast-api.ts';
import type { ConfigStore } from './config-store.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import type { ScreenHub } from './services/screens.ts';
import { tvTitle } from './services/tv.ts';
import { VOICE_MAX_BYTES, VoiceError, type VoiceMessages } from './services/voice-messages.ts';
import type { ScreenRecord, ScreenStore } from './sources/screens.ts';

export const SCREENS_PARENTS_ONLY = 'Les télés se gèrent par un parent';
export const OUTDATED_APP = 'Appli HomeHub TV trop ancienne ou trop récente pour ce serveur : la mettre à jour';

const label = z.string().trim().max(40).nullish();
const startSchema = z.object({ system: label, app: label });
const screenName = z.string().trim().min(1).max(40);
const pairSchema = z.object({ code: z.string().trim().min(1).max(20), name: screenName });
const renameSchema = z.object({ name: screenName });
const reportSchema = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), reason: z.string().trim().min(1).max(200) })]);
const eventIdSchema = z.string().uuid();

/** Une télé ne parle que la version du protocole du serveur (426 sinon : l'appli dit de se mettre à jour). */
function checkProtocol(c: Context) {
  if (c.req.header(SCREEN_PROTOCOL_HEADER) !== String(SCREEN_PROTOCOL)) fail(426, OUTDATED_APP);
}

const afterOf = (c: Context) => {
  const raw = c.req.query('after');
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fail(400, 'Paramètre after : entier positif');
};

export function createScreenApi({
  screens,
  hub,
  voice,
  config,
  household,
  access,
}: {
  screens: ScreenStore;
  hub: ScreenHub;
  voice: VoiceMessages;
  config: ConfigStore;
  household: Household;
  access: Access;
}) {
  const api = createRouter();
  const withPresence = (s: ScreenRecord): Screen => ({ ...s, online: hub.online(s.id) });
  const screenOf = async (id: string) => (await screens.list()).find((s) => s.id === id) ?? fail(404, 'Télé inconnue');
  /** La tablette, avec un parent reconnu devant elle. */
  const tabletParent = async (c: Context) => {
    await access.kiosk(c);
    await access.parent(c, SCREENS_PARENTS_ONLY);
  };

  // --- La télé ---

  api.post('/screen/pairing', async (c) => {
    checkProtocol(c);
    const { system, app } = await readBody(c, startSchema);
    return c.json(screens.startPairing({ system: system ?? null, app: app ?? null }), 201);
  });

  api.get('/screen/pairing/:id', async (c) => {
    checkProtocol(c);
    const state = await screens.pairing(c.req.param('id'), 25_000, c.req.raw.signal);
    return state ? c.json(state) : fail(410, 'Code expiré : en afficher un nouveau');
  });

  api.get('/screen/events', async (c) => {
    checkProtocol(c);
    const screen = await access.screen(c);
    return c.json(await hub.events(screen.id, afterOf(c), c.req.raw.signal));
  });

  api.post('/screen/events/:id/report', async (c) => {
    checkProtocol(c);
    const screen = await access.screen(c);
    const id = eventIdSchema.safeParse(c.req.param('id'));
    if (!id.success) return fail(400, 'Événement inconnu');
    hub.report(screen.id, id.data, await readBody(c, reportSchema, 'Compte rendu attendu : { "ok": true } ou { "ok": false, "reason": "…" }'));
    return c.body(null, 204);
  });

  api.get('/screen/clips/:token', async (c) => {
    await access.screen(c);
    const clip = voice.clip(c.req.param('token'));
    if (!clip) return fail(404, 'Message expiré');
    return c.body(clip.data.slice().buffer as ArrayBuffer, 200, { 'Content-Type': clip.contentType, 'Cache-Control': 'no-store', 'Content-Length': String(clip.data.byteLength) });
  });

  // --- La tablette ---

  api.get('/screens', async (c) => {
    await access.kiosk(c);
    return c.json((await screens.list()).map(withPresence));
  });

  api.post('/screens', async (c) => {
    await tabletParent(c);
    const { code, name } = await readBody(c, pairSchema, 'Code et nom attendus');
    const screen = await screens.confirm(code, name);
    return screen ? c.json(withPresence(screen), 201) : fail(410, 'Code inconnu ou expiré : relancer l’appli sur la télé pour en afficher un nouveau');
  });

  api.patch('/screens/:id', async (c) => {
    await tabletParent(c);
    await screenOf(c.req.param('id'));
    const { name } = await readBody(c, renameSchema, 'Nom attendu (40 caractères max)');
    const screen = await screens.rename(c.req.param('id'), name);
    return screen ? c.json(withPresence(screen)) : fail(404, 'Télé inconnue');
  });

  api.delete('/screens/:id', async (c) => {
    await tabletParent(c);
    const screen = await screenOf(c.req.param('id'));
    await screens.remove(screen.id);
    hub.forget(screen.id);
    return c.body(null, 204);
  });

  // --- Le téléphone d'un parent ---

  /** Le téléphone d'un parent, quand parler est permis : son prénom. */
  async function speaker(c: Context) {
    const author = await access.parent(c, VOICE_PARENTS_ONLY);
    if (author.via !== 'phone' || author.ownerId === null) return fail(403, VOICE_PHONE_ONLY);
    if (!config.current().camera.talk) return fail(403, VOICE_OFF);
    return household.nameOf(author.ownerId);
  }

  api.get('/screens/targets', async (c) => {
    await speaker(c);
    return c.json((await screens.list()).map((s): ScreenTarget => ({ id: s.id, name: s.name, online: hub.online(s.id) })));
  });

  api.post('/screens/:id/voice', async (c) => {
    const sender = await speaker(c);
    const screen = await screenOf(c.req.param('id'));
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > VOICE_MAX_BYTES) return fail(400, 'Message trop long');
    const audio = new Uint8Array(await c.req.arrayBuffer());
    let kept: ReturnType<VoiceMessages['keep']>;
    try {
      kept = voice.keep(audio, c.req.header('content-type') ?? '');
    } catch (err) {
      if (err instanceof VoiceError) return fail(err.status, err.message);
      throw err;
    }
    const report = await hub.send(screen.id, {
      kind: 'voice',
      id: randomUUID(),
      title: tvTitle(sender),
      audio: `/api/screen/clips/${kept.token}.${kept.extension}`,
      contentType: kept.contentType,
    });
    return report.ok ? c.json({ device: screen.name }) : fail(502, `${screen.name} : ${report.reason}`);
  });

  return api;
}
