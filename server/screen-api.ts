// Routes de l'appli HomeHub TV (télé appairée) et de sa gestion. La télé : demande d'appairage (sans jeton, elle n'en a
// pas encore), puis, avec son jeton, ses événements (interrogation longue), ses comptes rendus, son état et la liste des
// applis de son lanceur. La tablette : liste, appairage (code affiché sur la télé), nom, retrait, par un parent
// reconnu. Le téléphone d'un parent : les télés où parler en direct (le direct lui-même : screen-talk-api.ts ; le
// message vocal enregistré vers la télé a été retiré en 0.97.0). La télécommande (fonction 17, parents seulement) :
// état de la télé, tiroir des applis, touches, texte, lancement d'une appli, « À table ! », marche/arrêt ; une télé
// injoignable ou en veille s'allume par son appareil Cast. La télécommande montre aussi le mode film (son réglage :
// screen-media-api.ts) et ce qui passe (fonction 18) : programme, lecture ou pause, position recalculée à l'instant de
// la réponse, image à part.
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
  SCREEN_VOLUMES,
  type RemoteApps,
  type RemotePowerResult,
  type RemoteScreen,
  type Screen,
  type ScreenEventBody,
  type ScreenTarget,
} from '../shared/screen.ts';
import {
  artworkId,
  artworkType,
  cleanDuration,
  cleanPlayingText,
  NOW_PLAYING_ARTWORK_MAX,
  PLAYBACK_STATES,
  positionAfter,
  type RemoteArtwork,
  type RemoteNowPlaying,
} from '../shared/now-playing.ts';
import type { Access } from './access.ts';
import { VOICE_OFF, VOICE_PARENTS_ONLY, VOICE_PHONE_ONLY } from './cast-api.ts';
import type { ConfigStore } from './config-store.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { CastError, type CastTarget, castWake } from './services/cast.ts';
import { dinnerEvent, refusesVolume, VOLUME_FIXED } from './services/screen-media.ts';
import type { ScreenFilmService } from './services/screen-film.ts';
import { SCREEN_OFFLINE, type ScreenHub } from './services/screens.ts';
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
  volume: z.enum(SCREEN_VOLUMES).optional(),
  // Ce qui passe (fonction 18) : textes nettoyés ici quoi qu'ait fait l'appli, durée en direct (0, -1) oubliée,
  // image refusée si ce n'est ni du JPEG ni du PNG.
  nowPlaying: z
    .object({
      package: z.string().min(1).max(200),
      title: z.string().max(2_000).nullable().transform(cleanPlayingText),
      subtitle: z.string().max(2_000).nullable().transform(cleanPlayingText),
      state: z.enum(PLAYBACK_STATES),
      positionMs: z.number().finite().nullable().transform((ms) => (ms === null ? null : Math.max(0, Math.round(ms)))),
      durationMs: z.number().finite().nullable().transform(cleanDuration),
      artwork: z
        .string()
        .max(NOW_PLAYING_ARTWORK_MAX)
        .nullable()
        .transform((b) => (b && artworkType(b) ? b : null)),
    })
    .nullish(),
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
/**
 * Attente du compte rendu d'un texte : la télé vide le champ puis écrit lettre à lettre avec des pauses (Typing.plan
 * dans tv-app/…/Remote.kt : environ 0,5 s de vidage, 0,35 s après la première lettre, 40 ms par lettre ensuite).
 */
export const remoteTextReportMs = (text: string) => REMOTE_REPORT_MS + 1_500 + 60 * text.length;
/** Réveil par l'appli : au-delà, on essaie par Cast. */
export const WAKE_REPORT_MS = 5_000;
export const NO_CAST_TO_WAKE = 'Télé injoignable, et aucun appareil Cast connu pour l’allumer (cast.devices, kind: tv)';
export const UNKNOWN_APP = 'Appli inconnue sur cette télé';

/** Une télé ne parle que la version du protocole du serveur (426 sinon : l'appli dit de se mettre à jour). */
export function checkProtocol(c: Context) {
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
  config,
  household,
  access,
  wake = (target) => castWake(target, { log: (step) => console.log(`Allumage par Cast : ${step}`) }),
  film,
}: {
  screens: ScreenStore;
  /** Applis du lanceur de chaque télé (tiroir de la télécommande). */
  apps: ScreenAppStore;
  hub: ScreenHub;
  config: ConfigStore;
  household: Household;
  access: Access;
  /** Allumage par l'appareil Cast de la télé (remplaçable dans les tests). */
  wake?: (target: CastTarget) => Promise<void>;
  /** Mode film des télés (fonction 15) ; absent : jamais. */
  film?: ScreenFilmService;
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
  const withPresence = (s: ScreenRecord): Screen => ({ ...s, online: hub.online(s.id), power: hub.power(s.id) });
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
    film?.forget(screen.id);
    hub.forget(screen.id);
    return c.body(null, 204);
  });

  // --- Le téléphone d'un parent ---

  api.get('/screens/targets', async (c) => {
    // Le téléphone d'un parent, quand parler est permis.
    const author = await access.parent(c, VOICE_PARENTS_ONLY);
    if (author.via !== 'phone' || author.ownerId === null) return fail(403, VOICE_PHONE_ONLY);
    if (!config.current().camera.talk) return fail(403, VOICE_OFF);
    const targets = (await screens.list()).map(
      async (s): Promise<ScreenTarget> => ({ id: s.id, name: s.name, online: hub.online(s.id), on: hub.power(s.id) === 'on' }),
    );
    return c.json(await Promise.all(targets));
  });

  // --- La télécommande (un parent) ---

  const remoteOf = async (s: ScreenRecord): Promise<RemoteScreen> => {
    const power = hub.power(s.id);
    const state = power === 'offline' ? null : hub.stateOf(s.id);
    const list = await apps.get(s.id);
    const current = state?.foreground ?? null;
    const nameOf = (pkg: string) => list?.apps.find((a) => a.package === pkg)?.name ?? pkg;
    const foreground = current ? { package: current, name: nameOf(current) } : null;
    // Ce qui passe : seulement télé allumée (en veille, la session d'une appli peut traîner en pause).
    const playing = power === 'on' ? (state?.nowPlaying ?? null) : null;
    const nowPlaying: RemoteNowPlaying | null = playing && {
      package: playing.package,
      app: nameOf(playing.package),
      title: playing.title,
      subtitle: playing.subtitle,
      state: playing.state,
      positionMs: positionAfter(playing, hub.stateAgeOf(s.id)),
      durationMs: playing.durationMs,
      artworkId: playing.artwork ? artworkId(playing.artwork) : null,
    };
    return {
      id: s.id,
      name: s.name,
      power,
      control: state?.control ?? null,
      volume: state?.volume ?? null,
      foreground,
      nowPlaying,
      ...(film && { film: film.state(s.id) }),
      canWake: castOf(s.id) !== null,
      appsAt: list?.at ?? null,
      appCount: list?.apps.length ?? 0,
    };
  };

  /** Envoie un ordre de la télécommande et attend le compte rendu ; échec : 502 avec la raison donnée par la télé. */
  async function command(c: Context, screen: ScreenRecord, event: ScreenEventBody, waitMs = REMOTE_REPORT_MS) {
    const report = await hub.send(screen.id, event, waitMs);
    return report.ok ? c.json({ ok: true }) : fail(502, `${screen.name} : ${report.reason}`);
  }

  api.get('/screens/remote', async (c) => {
    await access.remote(c);
    return c.json(await Promise.all((await screens.list()).map(remoteOf)));
  });

  // Image de ce qui passe (affiche, logo de la chaîne) : à part, la télécommande la redemande quand son empreinte change.
  api.get('/screens/:id/artwork', async (c) => {
    await access.remote(c);
    const screen = await screenOf(c.req.param('id'));
    const artwork = hub.power(screen.id) === 'on' ? hub.stateOf(screen.id)?.nowPlaying?.artwork : null;
    const body: RemoteArtwork = artwork ? { id: artworkId(artwork), image: `data:${artworkType(artwork)};base64,${artwork}` } : { id: null, image: null };
    return c.json(body);
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
    if (refusesVolume(hub.stateOf(screen.id)?.volume, keys)) return fail(409, VOLUME_FIXED);
    return command(c, screen, { kind: 'key', id: randomUUID(), keys });
  });

  api.post('/screens/:id/text', async (c) => {
    await access.remote(c);
    const screen = await screenOf(c.req.param('id'));
    const { text, submit } = await readBody(c, textSchema, `Texte attendu (${REMOTE_TEXT_MAX} caractères max)`);
    return command(c, screen, { kind: 'text', id: randomUUID(), text, submit }, remoteTextReportMs(text));
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
    return command(c, screen, dinnerEvent(author.ownerId ? household.nameOf(author.ownerId) : null));
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
