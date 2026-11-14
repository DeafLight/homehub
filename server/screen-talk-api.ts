// Routes de « Parler en direct à la télé » (fonction 9, docs/appli-tele.md section 11). Le téléphone d'un parent
// (`access.talker` : parent, téléphone, `camera.talk`) ouvre une prise de parole vers une télé, envoie sa voix par
// morceaux numérotés (PCM 16 kHz, corps binaire) et l'arrête. La télé, à son jeton, demande le son reçu depuis son
// dernier numéro : corps binaire et numéro dans l'en-tête X-HomeHub-Seq, 204 s'il n'y a rien eu, 410 à la fin.
import type { Context } from 'hono';
import { SCREEN_PROTOCOL, SCREEN_PROTOCOL_HEADER } from '../shared/screen.ts';
import { TALK_CHUNK_MAX_BYTES, TALK_SEQ_HEADER } from '../shared/screen-talk.ts';
import type { Access } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail } from './http.ts';
import { OUTDATED_APP } from './screen-api.ts';
import type { ScreenTalk } from './services/screen-talk.ts';
import type { ScreenStore } from './sources/screens.ts';

const numberOf = (c: Context, name: string) => {
  const raw = c.req.query(name);
  const value = Number(raw);
  return raw !== undefined && raw !== '' && Number.isSafeInteger(value) && value >= 0 ? value : fail(400, `Paramètre ${name} : entier positif`);
};

export function createScreenTalkApi({ screens, talk, household, access }: { screens: ScreenStore; talk: ScreenTalk; household: Household; access: Access }) {
  const api = createRouter();
  const screenOf = async (id: string) => (await screens.list()).find((s) => s.id === id) ?? fail(404, 'Télé inconnue');

  // --- Le téléphone d'un parent ---

  api.post('/screens/:id/talk', async (c) => {
    const { ownerId, deviceId } = await access.talker(c);
    const screen = await screenOf(c.req.param('id'));
    return c.json(await talk.start({ screenId: screen.id, screenName: screen.name, deviceId, speakerName: household.nameOf(ownerId) }), 201);
  });

  api.post('/screens/:id/talk/:talk/audio', async (c) => {
    const { deviceId } = await access.talker(c);
    const seq = numberOf(c, 'seq');
    if (Number(c.req.header('content-length') ?? 0) > TALK_CHUNK_MAX_BYTES) return fail(413, 'Morceau de voix trop long');
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength > TALK_CHUNK_MAX_BYTES) return fail(413, 'Morceau de voix trop long');
    if (data.byteLength % 2 !== 0) return fail(400, 'Son attendu : PCM 16 bits');
    talk.push(c.req.param('talk'), deviceId, seq, data);
    return c.body(null, 204);
  });

  api.delete('/screens/:id/talk/:talk', async (c) => {
    const { deviceId } = await access.talker(c);
    try {
      talk.stop(c.req.param('talk'), deviceId);
    } catch {
      // Déjà finie et oubliée : rien à arrêter.
    }
    return c.body(null, 204);
  });

  // --- La télé ---

  api.get('/screen/talk/:talk', async (c) => {
    if (c.req.header(SCREEN_PROTOCOL_HEADER) !== String(SCREEN_PROTOCOL)) return fail(426, OUTDATED_APP);
    const screen = await access.screen(c);
    const after = numberOf(c, 'after');
    const { data, last, ended } = await talk.audio(c.req.param('talk'), screen.id, after, c.req.raw.signal);
    if (ended !== null) return fail(410, ended);
    const headers = { [TALK_SEQ_HEADER]: String(last), 'Cache-Control': 'no-store' };
    if (!data.byteLength) return c.body(null, 204, headers);
    return c.body(data.slice().buffer as ArrayBuffer, 200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.byteLength) });
  });

  return api;
}
