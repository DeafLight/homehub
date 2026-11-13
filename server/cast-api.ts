// Routes des messages vocaux vers les appareils Cast (Google Home, télé), depuis l'onglet Caméra. Seul le téléphone
// d'un parent envoie (jamais un enfant, jamais la tablette), et seulement si `camera.talk` est permis ; le corps est
// l'enregistrement tel quel (Content-Type : son format). L'appareil, lui, télécharge le message sans s'authentifier,
// à une adresse tirée au hasard qui expire en quelques minutes, servie aussi, seule, sur le port des médias.
import type { Access } from './access.ts';
import type { ConfigStore } from './config-store.ts';
import type { Household } from './household.ts';
import { createRouter, fail } from './http.ts';
import { VOICE_MAX_BYTES, VoiceError, type VoiceMessages } from './services/voice-messages.ts';

export const VOICE_PARENTS_ONLY = 'Les messages vocaux sont réservés aux parents';
export const VOICE_PHONE_ONLY = 'Les messages vocaux partent du téléphone d’un parent';
export const VOICE_OFF = 'Parler est désactivé (camera.talk)';

export function createCastApi({ voice, config, household, access }: { voice: VoiceMessages; config: ConfigStore; household: Household; access: Access }) {
  const api = createRouter();

  api.post('/cast/:device/voice', async (c) => {
    const author = await access.parent(c, VOICE_PARENTS_ONLY);
    if (author.via !== 'phone' || author.ownerId === null) return fail(403, VOICE_PHONE_ONLY);
    if (!config.current().camera.talk) return fail(403, VOICE_OFF);
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > VOICE_MAX_BYTES) return fail(400, 'Message trop long');
    const audio = new Uint8Array(await c.req.arrayBuffer());
    try {
      return c.json(await voice.send(c.req.param('device'), audio, c.req.header('content-type') ?? '', household.nameOf(author.ownerId)));
    } catch (err) {
      if (err instanceof VoiceError) return fail(err.status, err.message);
      throw err;
    }
  });

  api.route('/', createCastClipsApi(voice));
  return api;
}

/**
 * Le message, pour l'appareil Cast : pas d'authentification possible, l'adresse aléatoire en tient lieu. Monté dans
 * l'API, et seul sur le port des médias (HOMEHUB_MEDIA_PORT) quand l'application n'est pas joignable en direct du
 * réseau local (derrière un proxy).
 */
export function createCastClipsApi(voice: Pick<VoiceMessages, 'clip'>) {
  const api = createRouter();
  api.get('/cast/clips/:token', (c) => {
    const clip = voice.clip(c.req.param('token'));
    if (!clip) return fail(404, 'Message expiré');
    return c.body(clip.data.slice().buffer as ArrayBuffer, 200, { 'Content-Type': clip.contentType, 'Cache-Control': 'no-store', 'Content-Length': String(clip.data.byteLength) });
  });
  return api;
}

/** Serveur du port des médias : les messages des appareils Cast, rien d'autre (tout le reste : 404). */
export function createMediaApp(voice: Pick<VoiceMessages, 'clip'>) {
  const app = createRouter();
  app.route('/api', createCastClipsApi(voice));
  app.all('*', () => fail(404, 'Route inconnue'));
  return app;
}
