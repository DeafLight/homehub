// Routes de l'appli HomeHub TV (télé appairée) et de sa gestion. La télé : demande d'appairage (sans jeton, elle n'en a
// pas encore), puis, avec son jeton, ses événements (interrogation longue), ses comptes rendus et le téléchargement des
// messages vocaux. La tablette : liste, appairage (code affiché sur la télé), nom, retrait, par un parent reconnu. Le
// téléphone d'un parent : les télés où envoyer sa voix, et l'envoi (mêmes règles que vers un appareil Cast). La
// télécommande (fonction 17, parents seulement) : état de la télé, tiroir des applis, touches, texte, lancement d'une
// appli, « À table ! », marche/arrêt ; une télé injoignable ou en veille s'allume par son appareil Cast.
import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  REMOTE_KEYS,
  REMOTE_MAX_KEYS,
  REMOTE_TEXT_MAX,
  SCREEN_APPS_MAX,
  SCREEN_CONTROLS,
  SCREEN_PROTOCOL,
  SCREEN_PROTOCOL_HEADER,
  type RemoteApps,
  type RemotePowerResult,
  type RemoteScreen,
  type Screen,
  type ScreenEventBody,
  type ScreenTarget,
} from '../shared/screen.ts';
import type { Access } from './access.ts';
import { VOICE_OFF, VOICE_PARENTS_ONLY, VOICE_PHONE_ONLY } from './cast-api.ts';
import type { ConfigStore } from './config-store.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { CastError, type CastTarget, castWake } from './services/cast.ts';
import { SCREEN_OFFLINE, type ScreenHub } from './services/screens.ts';
import { tvTitle } from './services/tv.ts';
import { VOICE_MAX_BYTES, VoiceError, type VoiceMessages } from './services/voice-messages.ts';
import { screenAppSchema, type ScreenAppStore } from './sources/screen-apps.ts';
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
const stateSchema = z.object({
  screenOn: z.boolean(),
  foreground: z.string().max(200).nullable(),
  control: z.enum(SCREEN_CONTROLS),
  addresses: z.array(z.string().max(60)).max(8),
});
const appsSchema = z.object({ apps: z.array(screenAppSchema).max(SCREEN_APPS_MAX) });
const keysSchema = z.object({ keys: z.array(z.enum(REMOTE_KEYS)).min(1).max(REMOTE_MAX_KEYS) });
const textSchema = z.object({ text: z.string().min(1).max(REMOTE_TEXT_MAX), submit: z.boolean().default(false) });
const launchSchema = z.object({ package: z.string().min(1).max(200) });
const powerSchema = z.object({ on: z.boolean() });

/** Liste des applis envoyée par la télé : bannières comprises, quelques Mo au plus. */
export const APPS_MAX_BYTES = 10_000_000;
/** Attente du compte rendu d'une touche, d'un texte, d'un lancement : la télé répond en quelques dizaines de ms. */
export const REMOTE_REPORT_MS = 4_000;
/** Réveil par l'appli : au-delà, on essaie par Cast. */
export const WAKE_REPORT_MS = 5_000;
export const NO_CAST_TO_WAKE = 'Télé injoignable, et aucun appareil Cast connu pour l’allumer (cast.devices, kind: tv)';
export const UNKNOWN_APP = 'Appli inconnue sur cette télé';

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
  apps,
  hub,
  voice,
  config,
  household,
  access,
  wake = (target) => castWake(target, { log: (step) => console.log(`Allumage par Cast : ${step}`) }),
}: {
  screens: ScreenStore;
  /** Applis du lanceur de chaque télé (tiroir de la télécommande). */
  apps: ScreenAppStore;
  hub: ScreenHub;
  voice: VoiceMessages;
  config: ConfigStore;
  household: Household;
  access: Access;
  /** Allumage par l'appareil Cast de la télé (remplaçable dans les tests). */
  wake?: (target: CastTarget) => Promise<void>;
}) {
  const api = createRouter();

  /**
   * L'appareil Cast de la télé : celui dont l'adresse est l'une de celles annoncées par l'appli ; sinon, s'il n'y en a
   * qu'un, le seul appareil Cast de genre « tv ».
   */
  const castOf = (id: string): CastTarget | null => {
    const devices = config.current().cast.devices;
    const addresses = hub.stateOf(id)?.addresses ?? [];
    const tvs = devices.filter((d) => d.kind === 'tv');
    const found = devices.find((d) => addresses.includes(d.host)) ?? (tvs.length === 1 ? tvs[0] : undefined);
    return found ? { host: found.host, port: found.port } : null;
  };
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

  api.post('/screen/state', async (c) => {
    checkProtocol(c);
    const screen = await access.screen(c);
    hub.setState(screen.id, await readBody(c, stateSchema, 'État attendu : { screenOn, foreground, control, addresses }'));
    return c.body(null, 204);
  });

  api.put('/screen/apps', async (c) => {
    checkProtocol(c);
    const screen = await access.screen(c);
    if (Number(c.req.header('content-length') ?? 0) > APPS_MAX_BYTES) return fail(413, 'Liste des applis trop lourde');
    const { apps: list } = await readBody(c, appsSchema);
    await apps.set(screen.id, list);
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
    await apps.remove(screen.id);
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

  // --- La télécommande (un parent) ---

  const remoteOf = async (s: ScreenRecord): Promise<RemoteScreen> => {
    const power = hub.power(s.id);
    const state = power === 'offline' ? null : hub.stateOf(s.id);
    const list = await apps.get(s.id);
    const current = state?.foreground ?? null;
    const foreground = current ? { package: current, name: list?.apps.find((a) => a.package === current)?.name ?? current } : null;
    return { id: s.id, name: s.name, power, control: state?.control ?? null, foreground, canWake: castOf(s.id) !== null, appsAt: list?.at ?? null, appCount: list?.apps.length ?? 0 };
  };

  /** Envoie un ordre de la télécommande et attend le compte rendu ; échec : 502 avec la raison donnée par la télé. */
  async function command(c: Context, screen: ScreenRecord, event: ScreenEventBody) {
    const report = await hub.send(screen.id, event, REMOTE_REPORT_MS);
    return report.ok ? c.json({ ok: true }) : fail(502, `${screen.name} : ${report.reason}`);
  }

  api.get('/screens/remote', async (c) => {
    await access.remote(c);
    return c.json(await Promise.all((await screens.list()).map(remoteOf)));
  });

  api.get('/screens/:id/apps', async (c) => {
    await access.remote(c);
    const screen = await screenOf(c.req.param('id'));
    const list = await apps.get(screen.id);
    const body: RemoteApps = {
      at: list?.at ?? null,
      apps: (list?.apps ?? []).map((a) => ({ package: a.package, name: a.name, banner: a.banner ? `data:image/png;base64,${a.banner}` : null })),
    };
    return c.json(body);
  });

  api.post('/screens/:id/keys', async (c) => {
    await access.remote(c);
    const screen = await screenOf(c.req.param('id'));
    const { keys } = await readBody(c, keysSchema, 'Touches attendues');
    return command(c, screen, { kind: 'key', id: randomUUID(), keys });
  });

  api.post('/screens/:id/text', async (c) => {
    await access.remote(c);
    const screen = await screenOf(c.req.param('id'));
    const { text, submit } = await readBody(c, textSchema, `Texte attendu (${REMOTE_TEXT_MAX} caractères max)`);
    return command(c, screen, { kind: 'text', id: randomUUID(), text, submit });
  });

  api.post('/screens/:id/launch', async (c) => {
    await access.remote(c);
    const screen = await screenOf(c.req.param('id'));
    const { package: pkg } = await readBody(c, launchSchema, 'Appli attendue');
    if (!(await apps.get(screen.id))?.apps.some((a) => a.package === pkg)) return fail(404, UNKNOWN_APP);
    return command(c, screen, { kind: 'launch', id: randomUUID(), package: pkg });
  });

  // « À table ! » : pause de ce qui passe, et le bandeau qui le dit.
  api.post('/screens/:id/dinner', async (c) => {
    const author = await access.remote(c);
    const screen = await screenOf(c.req.param('id'));
    const name = author.ownerId ? household.nameOf(author.ownerId) : null;
    const subtitle = name ? tvTitle(name).replace(/^Message /u, 'De la part ') : 'HomeHub';
    return command(c, screen, { kind: 'key', id: randomUUID(), keys: ['pause'], notice: { title: 'À table !', subtitle } });
  });

  api.post('/screens/:id/power', async (c) => {
    await access.remote(c);
    const screen = await screenOf(c.req.param('id'));
    const { on } = await readBody(c, powerSchema, 'Attendu : { "on": true } ou { "on": false }');
    const power = hub.power(screen.id);
    const result = (r: RemotePowerResult) => c.json(r);
    if (!on) {
      if (power === 'offline') return fail(503, SCREEN_OFFLINE);
      const report = await hub.send(screen.id, { kind: 'power', id: randomUUID(), on: false }, REMOTE_REPORT_MS);
      return report.ok ? result({ power: 'standby', via: 'screen' }) : fail(502, `${screen.name} : ${report.reason}`);
    }
    if (power === 'on') return result({ power, via: null });
    // En veille mais joignable : l'appli rallume l'écran (touche de réveil) ; sinon, ou si elle échoue, par Cast.
    if (power === 'standby') {
      const report = await hub.send(screen.id, { kind: 'power', id: randomUUID(), on: true }, WAKE_REPORT_MS);
      if (report.ok) return result({ power: 'on', via: 'screen' });
    }
    const target = castOf(screen.id) ?? fail(503, NO_CAST_TO_WAKE);
    try {
      await wake(target);
    } catch (err) {
      if (err instanceof CastError) return fail(502, `${screen.name} : allumage par Cast impossible, ${err.message}`);
      throw err;
    }
    return result({ power: hub.power(screen.id), via: 'cast' });
  });

  return api;
}
