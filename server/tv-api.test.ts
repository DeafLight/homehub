// Tests du message à la télé : réservé aux parents (ni enfant, ni appareil non appairé, ni tablette sans personne
// reconnue), texte nettoyé et limité côté serveur, requête multipart au format de l'appli Notifications for Android
// TV (centre, police maximale, fond opaque, durée de la config), télé absente, injoignable ou qui refuse.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TV_MESSAGE_MAX } from '../shared/tv.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createTvNotifier, tvTitle } from './services/tv.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { connectedFrom, NOW } from './testing.ts';
import { createTvApi, TV_PARENTS_ONLY } from './tv-api.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';

type Sent = { url: string; form: FormData };

async function setup({ tv = { host: '192.168.1.40' } as unknown, answer = (): Response | Promise<Response> => new Response('OK') } = {}) {
  const clock = () => new Date(NOW);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'sam', name: 'Sam', color: '#e0a03c', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
      ...(tv !== null && { tv }),
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-tv-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const sent: Sent[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), form: init?.body as FormData });
    return answer();
  }) as typeof fetch;
  const api = createRouter();
  api.route('/', createTvApi({ tv: createTvNotifier({ rules: () => config.current().tv, fetchImpl }), household: createHousehold(config), access }));

  const phone = async (ownerId: string) => {
    const { code } = devices.createCode(ownerId);
    return (await devices.claim(code, `Téléphone de ${ownerId}`))!.token;
  };
  const send = (body: unknown, { from = OTHER, token, headers }: { from?: string; token?: string; headers?: Record<string, string> } = {}) =>
    api.request(
      '/tv/message',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) },
      connectedFrom(from),
    );
  return { send, sent, sessions, alex: await phone('alex'), sam: await phone('sam'), lea: await phone('lea') };
}

describe('API message à la télé : droits', () => {
  it('un enfant, un appareil non appairé, la tablette sans personne reconnue : refusés, rien n’est envoyé', async () => {
    const { send, sent, lea } = await setup();
    const child = await send({ text: 'Coucou' }, { token: lea });
    expect(child.status).toBe(403);
    expect(await child.json()).toMatchObject({ error: TV_PARENTS_ONLY });
    expect((await send({ text: 'Coucou' })).status).toBe(403);
    expect((await send({ text: 'Coucou' }, { from: TABLET })).status).toBe(403);
    expect(sent).toEqual([]);
  });

  it('un parent reconnu à la tablette peut envoyer', async () => {
    const { send, sent, sessions } = await setup();
    const { token } = sessions.open('sam', 10);
    expect((await send({ text: 'Au lit !' }, { from: TABLET, headers: { 'X-Actor-Session': token } })).status).toBe(200);
    expect(sent[0]!.form.get('title')).toBe('Message de Sam');
  });
});

describe('API message à la télé : envoi', () => {
  it('requête multipart au format de l’appli : centre, police maximale, fond noir opaque, 10 s par défaut', async () => {
    const { send, sent, alex } = await setup();
    const res = await send({ text: '  À table !\n On mange   dans 5 min ' }, { token: alex });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'À table ! On mange dans 5 min', seconds: 10 });
    expect(sent).toHaveLength(1);
    const { url, form } = sent[0]!;
    expect(url).toBe('http://192.168.1.40:7676/');
    expect(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'))).toEqual({
      msg: 'À table ! On mange dans 5 min',
      title: 'Message d’Alex',
      duration: '10',
      fontsize: '3',
      position: '4',
      bkgcolor: '#000000',
      transparency: '1',
    });
    expect(form.get('filename')).toBeInstanceOf(Blob);
  });

  it('port et durée de la config', async () => {
    const { send, sent, alex } = await setup({ tv: { host: 'tele.maison.lan', port: 8080, seconds: 20 } });
    expect(await (await send({ text: 'Coucou' }, { token: alex })).json()).toEqual({ text: 'Coucou', seconds: 20 });
    expect(sent[0]!.url).toBe('http://tele.maison.lan:8080/');
    expect(sent[0]!.form.get('duration')).toBe('20');
  });

  it('texte nettoyé par le serveur : chevrons et caractères invisibles retirés', async () => {
    const { send, sent, alex } = await setup();
    await send({ text: '<script>x</script>\u{202E}Bonsoir\u{200B}' }, { token: alex });
    expect(sent[0]!.form.get('msg')).toBe('scriptx/scriptBonsoir');
  });

  it('message vide, trop long ou mal formé : 400, rien n’est envoyé', async () => {
    const { send, sent, alex } = await setup();
    expect((await send({ text: ' \n\u{200B} ' }, { token: alex })).status).toBe(400);
    expect((await send({ text: 'a'.repeat(TV_MESSAGE_MAX + 1) }, { token: alex })).status).toBe(400);
    expect((await send({ text: 42 }, { token: alex })).status).toBe(400);
    expect((await send({}, { token: alex })).status).toBe(400);
    expect((await send({ text: `${'a'.repeat(TV_MESSAGE_MAX)}\n\n  ` }, { token: alex })).status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('pas de télé configurée : 404', async () => {
    const { send, sent, alex } = await setup({ tv: null });
    const res = await send({ text: 'Coucou' }, { token: alex });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('tv');
    expect(sent).toEqual([]);
  });

  it('télé injoignable ou qui refuse : 502 avec un message clair', async () => {
    const off = await setup({ answer: () => Promise.reject(new TypeError('fetch failed')) });
    const res = await off.send({ text: 'Coucou' }, { token: off.alex });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('ne répond pas');
    const refused = await setup({ answer: () => new Response('non', { status: 500 }) });
    const res2 = await refused.send({ text: 'Coucou' }, { token: refused.alex });
    expect(res2.status).toBe(502);
    expect((await res2.json()).error).toContain('refusé');
  });
});

describe('tvTitle', () => {
  it('élision devant une voyelle ou un h', () => {
    expect(tvTitle('Alex')).toBe('Message d’Alex');
    expect(tvTitle('Émile')).toBe('Message d’Émile');
    expect(tvTitle('Hugo')).toBe('Message d’Hugo');
    expect(tvTitle('Sam')).toBe('Message de Sam');
    expect(tvTitle(null)).toBe('Message');
  });
});
