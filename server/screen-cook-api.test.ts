// Tests des routes du mode cuisine sur la télé : « Sur la télé » depuis la fiche (tablette, téléphone), télé qui ouvre
// sa vue et le confirme, télé absente ou qui refuse (le mode cuisine d'avant reste), étape avancée depuis la télé, le
// téléphone ou la tablette (attente de la télé réveillée), minuteur d'une durée de l'étape lancé à la télécommande
// (minuteur de la maison, au nom de l'étape, auteur : qui a lancé), arrêt d'un minuteur qui sonne, fin par Retour ou
// depuis la fiche, recette retirée, droits (appareil non appairé, jeton de téléphone, version du protocole).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScreenCook, ScreenCookTarget } from '../shared/screen-cook.ts';
import { SCREEN_PROTOCOL_HEADER, type ScreenEvents } from '../shared/screen.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createRouter } from './http.ts';
import { NOT_A_STEP_DURATION, NO_COOK, TIMER_NOT_RINGING, createScreenCookApi } from './screen-cook-api.ts';
import { createScreenCooking } from './services/screen-cook.ts';
import { contentInputSchema, normalizeContent } from './services/recipes.ts';
import { createScreenHub, SCREEN_OFFLINE } from './services/screens.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createRecipeStore } from './sources/recipes.ts';
import { createScreenStore } from './sources/screens.ts';
import { createTimerStore } from './sources/timers.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const TV = '192.168.1.60';
const PROTOCOL = { [SCREEN_PROTOCOL_HEADER]: '1' };
const STEPS = ['Émincer l’oignon et les carottes.', 'Faire revenir 5 minutes, puis cuire 25 minutes à feu doux.', 'Servir chaud.'];

async function setup() {
  let now = NOW.getTime();
  const clock = () => new Date(now);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-screen-cook-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const screens = createScreenStore({ path: join(dir, 'screens.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, screens, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const hub = createScreenHub({ clock, waitMs: 30, reportMs: 2_000 });
  const recipes = createRecipeStore({ path: join(dir, 'recipes.json'), photosDir: join(dir, 'recipes'), clock });
  const timers = createTimerStore({ clock });
  const api = createRouter();
  api.route('/', createScreenCookApi({ screens, hub, cooking: createScreenCooking({ waitMs: 40 }), recipes, timers, access, clock }));

  const recipe = await recipes.add(
    { ours: normalizeContent(contentInputSchema.parse({ title: 'Mijoté de lentilles', servings: 4, ingredients: [], steps: STEPS.map((text) => ({ text })) })), source: null },
    { ownerId: 'alex', via: 'tablet' },
  );
  const { code } = devices.createCode('lea');
  const lea = (await devices.claim(code, 'Téléphone de Léa'))!.token;
  const start = screens.startPairing({ system: 'Android 10', app: '0.74.0' });
  const screen = (await screens.confirm(start.code, 'Télé du salon'))!;
  const paired = await screens.pairing(start.id, 0);
  if (paired?.status !== 'paired') throw new Error('télé non appairée');
  const tv = paired.token;

  type Options = { from?: string; token?: string; body?: unknown; headers?: Record<string, string> };
  const call = (method: string, path: string, { from = OTHER, token, body, headers }: Options = {}) =>
    api.request(
      path,
      { method, headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) },
      connectedFrom(from),
    );
  const atTv = (body?: unknown) => ({ from: TV, token: tv, headers: PROTOCOL, body });

  /** La télé écoute ses événements et répond à l'ouverture du mode cuisine (une fois), comme l'appli. */
  async function tvAnswers(report: { ok: true } | { ok: false; reason: string } = { ok: true }) {
    for (let i = 0; i < 100; i++) {
      const { events } = (await hub.events(screen.id, null)) as ScreenEvents;
      const cook = events.find((e) => e.kind === 'cook');
      if (cook) return hub.report(screen.id, cook.id, report);
    }
    throw new Error('aucun événement « cook » reçu');
  }
  /** La télé est en ligne (elle a demandé ses événements il y a peu). */
  const online = () => hub.events(screen.id, null);

  async function launch(from: Options = { from: TABLET }) {
    await online();
    const [res] = await Promise.all([call('POST', `/screens/${screen.id}/cook`, { ...from, body: { recipeId: recipe.id } }), tvAnswers()]);
    expect(res.status).toBe(201);
    return (await res.json()) as ScreenCookTarget;
  }
  const view = async (after = '') => ((await (await call('GET', `/screen/cook?after=${after}`, atTv())).json()) as { cook: ScreenCook | null }).cook;

  return { call, atTv, tvAnswers, online, launch, view, recipe, recipes, screen, timers, lea, advance: (ms: number) => (now += ms) };
}

describe('API mode cuisine sur la télé : lancement', () => {
  it('« Sur la télé » depuis la tablette : la télé ouvre sa vue et lit l’étape en cours', async () => {
    const { launch, view, recipe } = await setup();
    const target = await launch();
    expect(target).toMatchObject({ name: 'Télé du salon', online: true, cook: { recipeId: recipe.id, title: 'Mijoté de lentilles', index: 0, total: 3 } });
    expect(await view()).toMatchObject({ index: 0, step: { number: 1, text: STEPS[0] }, next: STEPS[1] });
  });

  it('depuis un téléphone appairé aussi ; liste des télés avec leur mode cuisine', async () => {
    const { launch, call, lea, screen } = await setup();
    await launch({ token: lea });
    const list = (await (await call('GET', '/screens/cook', { token: lea })).json()) as ScreenCookTarget[];
    expect(list).toEqual([expect.objectContaining({ id: screen.id, name: 'Télé du salon', cook: expect.objectContaining({ index: 0 }) })]);
  });

  it('télé absente : 503, pas de mode cuisine', async () => {
    const { call, screen, recipe, view } = await setup();
    const res = await call('POST', `/screens/${screen.id}/cook`, { from: TABLET, body: { recipeId: recipe.id } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: SCREEN_OFFLINE });
    expect(await view()).toBeNull();
  });

  it('télé qui n’ouvre pas sa vue : 502 avec sa raison, le mode cuisine d’avant reste', async () => {
    const { call, screen, recipe, launch, online, tvAnswers, view } = await setup();
    await launch();
    await call('POST', `/screens/${screen.id}/cook/step`, { from: TABLET, body: { index: 2 } });
    await online();
    const [res] = await Promise.all([
      call('POST', `/screens/${screen.id}/cook`, { from: TABLET, body: { recipeId: recipe.id } }),
      tvAnswers({ ok: false, reason: 'affichage par-dessus les autres applis refusé' }),
    ]);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Télé du salon : affichage par-dessus les autres applis refusé' });
    expect((await view())?.index).toBe(2);
  });

  it('recette ou télé inconnue : 404 ; appareil non appairé : 403', async () => {
    const { call, screen, recipe } = await setup();
    expect((await call('POST', `/screens/${screen.id}/cook`, { from: TABLET, body: { recipeId: 'inconnue' } })).status).toBe(404);
    expect((await call('POST', '/screens/inconnue/cook', { from: TABLET, body: { recipeId: recipe.id } })).status).toBe(404);
    expect((await call('POST', `/screens/${screen.id}/cook`, { body: { recipeId: recipe.id } })).status).toBe(403);
    expect((await call('GET', '/screens/cook')).status).toBe(403);
  });
});

describe('API mode cuisine sur la télé : étapes', () => {
  it('flèches de la télé, téléphone, tablette ; étape ramenée dans la recette', async () => {
    const { launch, call, atTv, screen, lea } = await setup();
    await launch();
    expect(((await (await call('POST', '/screen/cook/step', atTv({ index: 1 }))).json()) as { cook: ScreenCook }).cook.index).toBe(1);
    expect(((await (await call('POST', `/screens/${screen.id}/cook/step`, { token: lea, body: { index: 2 } })).json()) as { cook: ScreenCook }).cook).toMatchObject({ index: 2, next: null });
    expect(((await (await call('POST', `/screens/${screen.id}/cook/step`, { from: TABLET, body: { index: 9 } })).json()) as { cook: ScreenCook }).cook.index).toBe(2);
  });

  it('la télé qui attend est réveillée par un changement d’étape', async () => {
    const { launch, call, screen, view } = await setup();
    const { cook } = await launch();
    const started = performance.now();
    const [next] = await Promise.all([view(String(cook!.rev)), call('POST', `/screens/${screen.id}/cook/step`, { from: TABLET, body: { index: 1 } })]);
    expect(next?.index).toBe(1);
    expect(performance.now() - started).toBeLessThan(35);
  });

  it('sans mode cuisine : 404', async () => {
    const { call, atTv, screen } = await setup();
    expect(await (await call('POST', '/screen/cook/step', atTv({ index: 1 }))).json()).toEqual({ error: NO_COOK });
    expect((await call('POST', `/screens/${screen.id}/cook/step`, { from: TABLET, body: { index: 1 } })).status).toBe(404);
  });
});

describe('API mode cuisine sur la télé : minuteurs', () => {
  it('OK sur une durée de l’étape : minuteur de la maison au nom de l’étape, lancé au nom de qui a lancé le mode cuisine', async () => {
    const { launch, call, atTv, timers, lea } = await setup();
    await launch({ token: lea });
    await call('POST', '/screen/cook/step', atTv({ index: 1 }));
    const res = await call('POST', '/screen/cook/timers', atTv({ seconds: 1500 }));
    expect(res.status).toBe(201);
    const { cook } = (await res.json()) as { cook: ScreenCook };
    const [timer] = timers.list();
    expect(timer).toMatchObject({ label: 'Cuisson · ét. 2 · Mijoté de l…', durationSeconds: 1500, startedBy: { ownerId: 'lea', via: 'phone' } });
    expect(cook.step?.durations).toEqual([
      { seconds: 300, text: '5 min', timerId: null },
      { seconds: 1500, text: '25 min', timerId: timer.id },
    ]);
    expect(cook.timers).toEqual([expect.objectContaining({ id: timer.id, remainingSeconds: 1500, ended: false, step: 2 })]);
  });

  it('durée que l’étape ne cite pas : 400', async () => {
    const { launch, call, atTv } = await setup();
    await launch();
    expect(await (await call('POST', '/screen/cook/timers', atTv({ seconds: 300 }))).json()).toEqual({ error: NOT_A_STEP_DURATION });
  });

  it('arrêt depuis la télé : un minuteur qui sonne seulement', async () => {
    const { launch, call, atTv, timers, advance } = await setup();
    await launch();
    await call('POST', '/screen/cook/step', atTv({ index: 1 }));
    await call('POST', '/screen/cook/timers', atTv({ seconds: 300 }));
    const [timer] = timers.list();
    expect(await (await call('DELETE', `/screen/cook/timers/${timer.id}`, atTv())).json()).toEqual({ error: TIMER_NOT_RINGING });
    advance(301_000);
    const res = await call('DELETE', `/screen/cook/timers/${timer.id}`, atTv());
    expect(res.status).toBe(200);
    expect(timers.list()).toEqual([]);
  });
});

describe('API mode cuisine sur la télé : fin et droits', () => {
  it('Retour sur la télé, ou « Arrêter » depuis la fiche : plus de mode cuisine', async () => {
    const { launch, call, atTv, screen, view } = await setup();
    await launch();
    expect((await call('DELETE', '/screen/cook', atTv())).status).toBe(204);
    expect(await view()).toBeNull();
    await launch();
    expect((await call('DELETE', `/screens/${screen.id}/cook`, { from: TABLET })).status).toBe(204);
    expect(await view()).toBeNull();
  });

  it('recette retirée : le mode cuisine s’arrête', async () => {
    const { launch, recipes, recipe, view } = await setup();
    await launch();
    await recipes.remove(recipe.id);
    expect(await view()).toBeNull();
  });

  it('jeton de téléphone sur les routes de la télé : 401 ; sans la version du protocole : 426', async () => {
    const { call, lea, atTv } = await setup();
    expect((await call('GET', '/screen/cook', { from: TV, token: lea, headers: PROTOCOL })).status).toBe(401);
    expect((await call('GET', '/screen/cook', { ...atTv(), headers: {} })).status).toBe(426);
  });
});
