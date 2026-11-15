// Tests du message à la télé : réservé aux parents (ni enfant, ni appareil non appairé, ni tablette sans personne
// reconnue), texte nettoyé et limité côté serveur, événement `message` aux télés appairées avec l'appli HomeHub TV et
// compte rendu de chaque télé joignable ; sans télé appairée, 404 (l'appli tierce a été retirée en 0.77.0).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScreenEvent, ScreenReport } from '../shared/screen.ts';
import { TV_MESSAGE_MAX } from '../shared/tv.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createScreenHub, SCREEN_OFFLINE } from './services/screens.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import type { ScreenRecord, ScreenStore } from './sources/screens.ts';
import { connectedFrom, NOW } from './testing.ts';
import { createTvApi, TV_NONE, TV_PARENTS_ONLY } from './tv-api.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const SALON = { id: 'salon', name: 'Télé du salon' };
const CHAMBRE = { id: 'chambre', name: 'Télé de la chambre' };

/** Fausses télés HomeHub TV qui écoutent encore : arrêtées à la fin de chaque test. */
const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

async function setup({ tv = null as unknown, paired = [SALON] as { id: string; name: string }[] } = {}) {
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
  const hub = createScreenHub({ clock, waitMs: 20, reportMs: 1_000 });
  const at = NOW.toISOString();
  const records = paired.map((p): ScreenRecord => ({ ...p, system: 'Android 10', app: '0.77.0', pairedAt: at, lastSeenAt: at }));
  const screens = { list: async () => records } as unknown as ScreenStore;
  const api = createRouter();
  api.route('/', createTvApi({ screens, hub, config, household: createHousehold(config), access }));

  /** Une télé HomeHub TV qui écoute ses événements et rend compte de chacun. */
  const received: ScreenEvent[] = [];
  const listen = (id: string, report: (e: ScreenEvent) => ScreenReport = () => ({ ok: true })) => {
    let stopped = false;
    stops.push(() => (stopped = true));
    void (async () => {
      let after: number | null = null;
      while (!stopped) {
        const found = await hub.events(id, after);
        after = found.last;
        for (const e of found.events) {
          received.push(e);
          hub.report(id, e.id, report(e));
        }
      }
    })();
  };

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
  return { send, sessions, listen, received, alex: await phone('alex'), sam: await phone('sam'), lea: await phone('lea') };
}

describe('API message à la télé : droits', () => {
  it('un enfant, un appareil non appairé, la tablette sans personne reconnue : refusés, rien n’est envoyé', async () => {
    const { send, listen, received, lea } = await setup();
    listen(SALON.id);
    const child = await send({ text: 'Coucou' }, { token: lea });
    expect(child.status).toBe(403);
    expect(await child.json()).toMatchObject({ error: TV_PARENTS_ONLY });
    expect((await send({ text: 'Coucou' })).status).toBe(403);
    expect((await send({ text: 'Coucou' }, { from: TABLET })).status).toBe(403);
    expect(received).toEqual([]);
  });

  it('un parent reconnu à la tablette peut envoyer ; 10 s par défaut sans tv dans la config', async () => {
    const { send, listen, received, sessions } = await setup();
    listen(SALON.id);
    const { token } = sessions.open('sam', 10);
    const res = await send({ text: 'Au lit' }, { from: TABLET, headers: { 'X-Actor-Session': token } });
    expect(await res.json()).toEqual({ text: 'Au lit', seconds: 10, screens: ['Télé du salon'] });
    expect(received[0]).toMatchObject({ title: 'Message de Sam' });
  });
});

describe('API message à la télé : envoi', () => {
  it('télé appairée : événement message (titre, texte nettoyé, durée de la config)', async () => {
    const { send, listen, received, alex } = await setup({ tv: { seconds: 15 } });
    listen(SALON.id);
    const res = await send({ text: '  À table !\n On mange   dans 5 min ' }, { token: alex });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'À table ! On mange dans 5 min', seconds: 15, screens: ['Télé du salon'] });
    expect(received).toEqual([expect.objectContaining({ kind: 'message', title: 'Message d’Alex', text: 'À table ! On mange dans 5 min', seconds: 15 })]);
  });

  it('une ancienne config avec tv.host et tv.port marche encore, les clés sont ignorées', async () => {
    const { send, listen, received, alex } = await setup({ tv: { host: '192.168.1.40', port: 7676, seconds: 20 } });
    listen(SALON.id);
    expect(await (await send({ text: 'Coucou' }, { token: alex })).json()).toEqual({ text: 'Coucou', seconds: 20, screens: ['Télé du salon'] });
    expect(received).toHaveLength(1);
  });

  it('texte nettoyé par le serveur : chevrons et caractères invisibles retirés', async () => {
    const { send, listen, received, alex } = await setup();
    listen(SALON.id);
    await send({ text: '<script>x</script>\u{202E}Bonsoir\u{200B}' }, { token: alex });
    expect(received[0]).toMatchObject({ text: 'scriptx/scriptBonsoir' });
  });

  it('message vide, trop long ou mal formé : 400, rien n’est envoyé', async () => {
    const { send, listen, received, alex } = await setup();
    listen(SALON.id);
    expect((await send({ text: ' \n\u{200B} ' }, { token: alex })).status).toBe(400);
    expect((await send({ text: 'a'.repeat(TV_MESSAGE_MAX + 1) }, { token: alex })).status).toBe(400);
    expect((await send({ text: 42 }, { token: alex })).status).toBe(400);
    expect((await send({}, { token: alex })).status).toBe(400);
    expect((await send({ text: `${'a'.repeat(TV_MESSAGE_MAX)}\n\n  ` }, { token: alex })).status).toBe(200);
    expect(received).toHaveLength(1);
  });

  it('aucune télé appairée : 404 avec un message clair, même avec tv.host dans la config', async () => {
    for (const tv of [null, { host: '192.168.1.40' }]) {
      const { send, alex } = await setup({ tv, paired: [] });
      const res = await send({ text: 'Coucou' }, { token: alex });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe(TV_NONE);
    }
  });

  it('plusieurs télés : affiché sur celles qui le disent, les injoignables sont passées', async () => {
    const { send, listen, received, alex } = await setup({ paired: [SALON, CHAMBRE, { id: 'bureau', name: 'Télé du bureau' }] });
    listen(SALON.id);
    listen(CHAMBRE.id, () => ({ ok: false, reason: 'affichage par-dessus non autorisé' }));
    const res = await send({ text: 'Coucou' }, { token: alex });
    expect(await res.json()).toEqual({ text: 'Coucou', seconds: 10, screens: ['Télé du salon'] });
    expect(received.map((e) => e.kind)).toEqual(['message', 'message']);
  });

  it('télé appairée mais injoignable : 503', async () => {
    const { send, alex } = await setup();
    const res = await send({ text: 'Coucou' }, { token: alex });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(SCREEN_OFFLINE);
  });

  it('aucune télé ne l’a affiché : 502 avec la raison de chacune', async () => {
    const { send, listen, alex } = await setup();
    listen(SALON.id, () => ({ ok: false, reason: 'affichage par-dessus non autorisé' }));
    const res = await send({ text: 'Coucou' }, { token: alex });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Télé du salon : affichage par-dessus non autorisé');
  });
});
