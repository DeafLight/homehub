// Refait les captures de la doc (docs/images/) : HomeHub lancé dans un monde fictif (scripts/docs-captures/),
// rempli de données d'exemple, photographié par Chrome sans fenêtre (protocole DevTools, sans dépendance).
// À lancer depuis le dossier du repo, après `npm run build` :
//   node scripts/docs-captures.ts            toutes les captures et la planche du design
//   node scripts/docs-captures.ts <regex>    seulement les captures dont le nom correspond (ex. « telephone »)
//   DOCS_SERVE=1 node scripts/docs-captures.ts   le monde fictif reste ouvert (http://localhost:3190), sans captures
// Chrome est cherché aux emplacements habituels ; sinon : CHROME=<chemin> node scripts/docs-captures.ts
// Rien de réel : famille de test, faux ÉcoleDirecte, faux temps réel Irigo ; seule la météo est la vraie du jour.
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { emptyFitness, FIRST_WAVE, PALIERS, type Palier, planSession, SECOND_WAVE, type SessionNumber, weekOf } from '../shared/fitness.ts';
import { BLOG_URL, COPIED_TEXT, recipeUrl, REFUSED_URL } from './docs-captures/fake-recipes.ts';
import { DOCS_BEFORE_HOLIDAYS, DOCS_HOLIDAYS, DOCS_NOW, DOCS_PUBLIC_HOLIDAY, DOCS_PRODUCTS, DOCS_UNKNOWN } from './docs-captures/fake-world.ts';

const ROOT = resolve(import.meta.dirname, '..');
const HERE = join(ROOT, 'scripts', 'docs-captures');
const OUT = join(ROOT, 'docs', 'images');
const PORT = 3190;
const BASE = `http://localhost:${PORT}`;
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(ROOT, 'web', 'dist', 'index.html'))) {
  console.error('Front non compilé : lancer d’abord npm run build');
  process.exit(1);
}
const chromePath = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p): p is string => !!p && existsSync(p));
if (!chromePath) {
  console.error('Chrome introuvable : CHROME=<chemin> node scripts/docs-captures.ts');
  process.exit(1);
}

// --- Dossier d'état fictif : deux téléphones reliés (jetons connus) et un relevé du NAS d'exemple, récent.
const work = mkdtempSync(join(tmpdir(), 'homehub-docs-'));
const state = join(work, 'state');
mkdirSync(state);
const TOKENS = { alex: 'docs-alex', lea: 'docs-lea' } as const;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const paired = new Date(DOCS_NOW - 4 * 86_400_000).toISOString();
const seen = new Date(DOCS_NOW - 3_600_000).toISOString();
const device = (ownerId: keyof typeof TOKENS, name: string, system: string) => ({
  id: `docs-${ownerId}`, ownerId, name, system, pairedAt: paired, lastSeenAt: seen, tokenHash: hash(TOKENS[ownerId]),
});
writeFileSync(join(state, 'devices.json'), JSON.stringify({
  version: 1,
  devices: [device('alex', 'Téléphone d’Alex', 'Android 16'), device('lea', 'Téléphone de Léa', 'iOS 26')],
}));
// Programme de sport d'Alex : six semaines de séances (répétitions en hausse, une semaine creuse), le rythme monté de
// 35/25 à 45/15 au fil des bonnes semaines, puis le palier 2 choisi lundi : en deux temps, jambes, dos et gainage sont
// passés (« nouveau » dans la séance 3, pas encore faite), cardio, poussée et une jambe attendent. Deux séances cette
// semaine, « facile » deux fois aux pompes inclinées larges (changement proposé), tour de taille de six semaines.
const fitness = emptyFitness();
const monday = new Date(`${weekOf(new Date(DOCS_NOW))}T18:30:00`);
const at = (days: number) => new Date(monday.getTime() + days * 86_400_000).toISOString();
const done = (days: number, session: SessionNumber, rpe: number, effort: number, rest: number, ratings: Record<string, string> = {}, palier: Palier = 1) => ({
  id: `docs-${days}`, at: at(days), session, palier, effort, rest, rounds: PALIERS[palier].rounds, rpe, stopped: false, note: null,
  exercises: planSession(palier === 1 ? emptyFitness() : fitness, session).map(({ family, exercise }) => ({
    family, exercise: exercise.id, rating: (ratings[family] ?? 'ok') as 'ok', pain: null,
    // un peu plus chaque semaine : 7 répétitions (ou 15 s) il y a six semaines, 12 (ou 25 s) maintenant
    reps: Math.round((exercise.unit === 's' ? 25 : 12) * (1 + Math.min(0, days) / 100)), note: null,
  })),
});
fitness.sessions.push(
  done(-42, 1, 4, 35, 25), done(-40, 2, 3, 35, 25), done(-35, 3, 3, 35, 25), done(-33, 1, 3, 35, 25), done(-31, 2, 3, 35, 25),
  done(-21, 3, 3, 40, 20), done(-14, 1, 3, 40, 20, { gainage: 'dur' }), done(-12, 2, 2, 40, 20), done(-10, 3, 3, 40, 20),
  done(-7, 1, 2, 45, 15), done(-5, 2, 3, 45, 15, { poussee: 'facile' }), done(-3, 3, 2, 45, 15),
);
const review = (days: number, choice: 'up-same' | 'next-palier', from: { palier: Palier; effort: number; rest: number }) =>
  (fitness.reviews[weekOf(new Date(at(days - 7)))] = { at: at(days - 0.1), choice, from });
review(-28, 'up-same', { palier: 1, effort: 35, rest: 25 });
review(-7, 'up-same', { palier: 1, effort: 40, rest: 20 });
review(0, 'next-palier', { palier: 1, effort: 45, rest: 15 });
Object.assign(fitness, { palier: 2, effort: 35, rest: 15, stage: { moved: [...FIRST_WAVE], waiting: [...SECOND_WAVE], since: at(-0.1) } });
fitness.sessions.push(done(0, 1, 3, 35, 15, {}, 2), done(1, 2, 3, 35, 15, { poussee: 'facile' }, 2));
fitness.weeks = {
  [weekOf(new Date(at(-35)))]: { cardio: 30, waist: 95 }, [weekOf(new Date(at(-28)))]: { cardio: null, waist: 94.5 },
  [weekOf(new Date(at(-21)))]: { cardio: 45, waist: 94.5 }, [weekOf(new Date(at(-14)))]: { cardio: 60, waist: 94 },
  [weekOf(new Date(at(-7)))]: { cardio: 75, waist: 93.5 }, [weekOf(new Date(at(0)))]: { cardio: 40, waist: 93 },
};
writeFileSync(join(state, 'fitness.json'), JSON.stringify({ version: 1, members: { alex: fitness } }));
// Visage fictif d'Alex (empreinte arbitraire) : les captures du sport de la tablette s'en servent pour être reconnues.
const FACE = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1));
writeFileSync(join(state, 'faces.json'), JSON.stringify({ version: 1, faces: { alex: [FACE] }, learned: {} }));
const nas = JSON.parse(readFileSync(join(ROOT, 'server', 'sources', 'fixtures', 'nas-status.json'), 'utf8'));
nas.generatedAt = new Date(DOCS_NOW - 5 * 60_000).toISOString();
writeFileSync(join(work, 'nas-status.json'), JSON.stringify(nas));

const children: ChildProcess[] = [];
/** Arrête Chrome et le serveur, attend qu'ils aient lâché leurs fichiers, puis efface le dossier de travail. */
async function cleanup(): Promise<void> {
  await Promise.all(children.map((c) => (c.exitCode !== null || c.signalCode !== null ? null : new Promise((r) => {
    c.once('exit', r);
    c.kill();
  }))));
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.warn(`Dossier de travail laissé : ${work}`);
  }
}
// En cas d'erreur, ne laisser tourner ni Chrome ni le serveur (le dossier de travail reste dans le dossier temporaire).
process.on('exit', () => {
  for (const c of children) if (c.exitCode === null) c.kill();
});

// --- Serveur : lancé à DOCS_NOW ; relancé plus loin à d'autres instants (vacances scolaires), même dossier d'état.
let server: ChildProcess | undefined;
async function startServer(now = DOCS_NOW): Promise<void> {
  if (server && server.exitCode === null && server.signalCode === null) await new Promise((r) => {
    server!.once('exit', r);
    server!.kill();
  });
  const child = spawn(process.execPath, [join(HERE, 'server.ts')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOMEHUB_CONFIG: join(HERE, 'homehub.yaml'),
      HOMEHUB_STATE_DIR: state,
      HOMEHUB_NAS_STATUS: join(work, 'nas-status.json'),
      DOCS_NOW: String(now),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  children.push(child);
  let serverLog = '';
  child.stdout?.on('data', (d) => (serverLog += d));
  child.stderr?.on('data', (d) => (serverLog += d));
  for (let i = 0; ; i++) {
    if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) break;
    if (i > 60) throw new Error(`le serveur ne répond pas :\n${serverLog}`);
    await sleep(500);
  }
}
await startServer();

// --- Données d'exemple, écrites par les téléphones (un parent écrit partout, Léa sur son profil).
async function call(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    // Sans jeton : la tablette (le serveur est sur la même machine).
    headers: { ...(token && { authorization: `Bearer ${token}` }), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} : ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
const A = TOKENS.alex;
const L = TOKENS.lea;
const steps = (prefix: string, labels: string[]) => labels.map((label, i) => ({ id: `${prefix}${i}`, label, days: null }));
const ROUTINES = {
  windows: { morning: { from: '05:00', to: '11:00' }, evening: { from: '17:00', to: '23:00' } },
  members: {
    alex: { morning: [], evening: [] },
    sam: { morning: [], evening: [] },
    // « Cartable » : jours d'école seulement (du lundi au vendredi), mis de côté pendant les vacances.
    lea: { morning: [...steps('lm', ['S’habiller', 'Petit-déjeuner', 'Dents']), { id: 'lm3', label: 'Cartable', days: [1, 2, 3, 4, 5] }], evening: steps('le', ['Douche', 'Pyjama', 'Devoirs']) },
    tom: { morning: steps('tm', ['S’habiller', 'Petit-déjeuner', 'Dents']), evening: steps('te', ['Bain', 'Pyjama', 'Histoire']) },
  },
};
await call(A, 'PUT', '/routines', ROUTINES);
for (const label of ['Lait', 'Pain', 'Tomates', 'Pâtes', 'Lessive', 'Yaourts nature', 'Pommes']) await call(A, 'POST', '/lists/shopping', { label });
const day = (offset: number) => {
  const d = new Date(DOCS_NOW + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
for (const task of [
  { label: 'Sortir les poubelles', ownerId: 'sam', due: day(0), repeat: { every: 1, unit: 'week' } },
  { label: 'Ranger sa chambre', ownerId: 'lea', due: day(2) },
  { label: 'Arroser les plantes', ownerId: 'tom', due: day(-1) },
  { label: 'Prendre rendez-vous chez le dentiste', ownerId: 'alex', due: null },
  { label: 'Vider le lave-vaisselle', ownerId: 'lea', due: day(0), repeat: { every: 1, unit: 'day' } },
]) await call(A, 'POST', '/lists/tasks', task);
await call(L, 'POST', '/notes', { to: 'alex', text: 'Je rentre à 17 h 30 ce soir, j’ai théâtre' });
await call(A, 'POST', '/notes', { to: 'lea', text: 'Pense à ta tenue de sport pour demain' });
await call(A, 'POST', '/notes', { to: 'famille', text: 'Pizza ce soir 🍕' });
await call(L, 'PUT', '/dashboard/lea/routine/morning-0', { done: true });
await call(L, 'PUT', '/dashboard/lea/routine/morning-1', { done: true });
await call(A, 'PUT', '/dashboard/tom/routine/morning-0', { done: true });
const timer = (await call(A, 'POST', '/timers', { label: '🍝 Cuisson', seconds: 540 })) as { id: string };
// Stock : courses rangées (produits des fausses bases, un saisi à la main), un bocal rechargé, un produit épuisé.
for (const code of Object.values(DOCS_PRODUCTS)) await call(A, 'GET', `/stock/scan/${code}`);
await call(A, 'PUT', `/stock/products/${DOCS_UNKNOWN}`, { name: 'Confiture de fraises', brand: 'Ferme des Coteaux', quantity: '370 g', category: null });
for (const [code, count, price] of [
  [DOCS_PRODUCTS.lait, 4, 1.15], [DOCS_PRODUCTS.pates, 3, 0.95], [DOCS_PRODUCTS.cafe, 2, 4.8], [DOCS_PRODUCTS.shampooing, 1, null],
  [DOCS_PRODUCTS.lessive, 1, 7.9], [DOCS_PRODUCTS.riz, 1, 2.6], [DOCS_UNKNOWN, 2, null],
] as const) await call(A, 'POST', '/stock/in', { code, count, price });
const jar = (await call(A, 'POST', '/stock/containers', { name: 'Bocal à café' })) as { id: string };
await call(A, 'POST', '/stock/out', { code: DOCS_PRODUCTS.cafe, refill: jar.id });
await call(A, 'POST', '/stock/containers', { name: 'Boîte à riz' });
// Qui a scanné : Alex et Léa par leur téléphone ; le riz sur la tablette, sans personne de reconnu (anonyme).
await call('', 'POST', '/stock/out', { code: DOCS_PRODUCTS.riz, all: true });
await call(L, 'POST', '/stock/out', { code: DOCS_PRODUCTS.lait });

// Carnet de recettes : trois recettes importées du faux site (cuisine.exemple.test), une saisie à la main ; notre
// version des galettes modifiée (astuce, beurre demi-sel corrigé à la main).
type Imported = { recipe: { id: string; ours: { ingredients: { text: string }[] } & Record<string, unknown> } };
const lentilles = ((await call(A, 'POST', '/recipes/import', { url: recipeUrl('mijote-lentilles-cookeo') })) as Imported).recipe;
const galettes = ((await call(L, 'POST', '/recipes/import', { url: recipeUrl('galettes-sarrasin') })) as Imported).recipe;
await call(A, 'POST', '/recipes/import', { url: `Regarde ça : ${recipeUrl('riz-saute-legumes')}` });
await call(A, 'PUT', `/recipes/${galettes.id}`, {
  content: {
    ...galettes.ours,
    ingredients: galettes.ours.ingredients.map((l) => (l.text.startsWith('Beurre') ? { ...l, text: 'Beurre demi-sel pour la poêle', name: 'beurre demi-sel', manual: true } : l)),
    tips: 'La pâte est meilleure préparée la veille. Garniture du dimanche : jambon, emmental et un œuf au plat.',
  },
});
const fromBlog = (await call(A, 'POST', '/recipes/import', { url: BLOG_URL })) as { draft?: unknown };
if (!fromBlog.draft) throw new Error('import du blog : brouillon attendu');
await call(A, 'POST', '/recipes', {
  content: {
    title: 'Pâtes au thon de Sam',
    servings: 4,
    ingredients: ['400 g de pâtes', '1 boîte de thon au naturel', '1 brique de crème fraîche', '1 citron', 'Persil'].map((text) => ({ text })),
    steps: ['Cuire les pâtes 10 minutes.', 'Mélanger le thon émietté, la crème et le jus du citron, ajouter aux pâtes égouttées.', 'Parsemer de persil.'].map((text) => ({ text })),
    tips: 'Les enfants les préfèrent sans persil.',
  },
});

// DOCS_SERVE=1 : pas de captures, le monde fictif reste ouvert sur BASE (essais à la main) jusqu'à Ctrl+C.
if (process.env.DOCS_SERVE) {
  await call(A, 'DELETE', `/timers/${timer.id}`);
  console.log(`Monde fictif sur ${BASE} (Ctrl+C pour arrêter)`);
  await new Promise((r) => process.once('SIGINT', r));
  await cleanup();
  process.exit(0);
}

// --- Chrome sans fenêtre, piloté par le protocole DevTools (WebSocket natif de Node).
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${PORT + 1}`, `--user-data-dir=${join(work, 'chrome')}`,
  '--no-first-run', '--hide-scrollbars', '--lang=fr-FR', '--force-color-profile=srgb',
  // Fausse caméra (mire animée), autorisée seulement pour la capture du scanner du téléphone (voir `camera`).
  '--use-fake-device-for-media-stream', 'about:blank',
], { stdio: 'ignore' });
children.push(chrome);
let wsUrl = '';
for (let i = 0; !wsUrl; i++) {
  if (i > 60) throw new Error('Chrome ne répond pas');
  await sleep(250);
  wsUrl = await fetch(`http://127.0.0.1:${PORT + 1}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl, () => '');
}
const socket = new WebSocket(wsUrl);
await new Promise((r) => socket.addEventListener('open', r, { once: true }));
type Message = { id?: number; method?: string; sessionId?: string; result?: unknown; error?: unknown };
let nextId = 1;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
const listeners: ((m: Message) => void)[] = [];
socket.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data)) as Message;
  const p = m.id === undefined ? undefined : pending.get(m.id);
  if (p) {
    pending.delete(m.id!);
    if (m.error) p.rej(new Error(JSON.stringify(m.error)));
    else p.res(m.result);
  } else for (const l of listeners) l(m);
});
const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });

type Metrics = { width: number; height: number; deviceScaleFactor: number; mobile: boolean };
const TABLET: Metrics = { width: 1280, height: 800, deviceScaleFactor: 1.5, mobile: false };
const PHONE: Metrics = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
/** Instant de départ de l'horloge du navigateur : celui du serveur en cours. */
let browserNow = DOCS_NOW;
const fakeClock = () => `(() => {
  const offset = ${browserNow} - Date.now(); const R = Date;
  class F extends R { constructor(...a) { a.length ? super(...a) : super(R.now() + offset); } static now() { return R.now() + offset; } }
  globalThis.Date = F; })();`;
const asPhone = (ownerId: keyof typeof TOKENS) =>
  `localStorage.setItem('homehub.phone', JSON.stringify({ token: '${TOKENS[ownerId]}', ownerId: '${ownerId}' }));`;

async function shoot(name: string, url: string, metrics: Metrics, { init = '', after = '', wait = 3000, settle = 1000, camera = false } = {}) {
  if (only && !only.test(name)) return;
  if (camera) await send('Browser.grantPermissions', { origin: BASE, permissions: ['videoCapture'] });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', metrics, sessionId);
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Paris' }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeClock() + init }, sessionId);
  const loaded = new Promise<void>((r) => listeners.push((m) => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && r()));
  await send('Page.navigate', { url }, sessionId);
  await loaded;
  await sleep(wait);
  if (after) {
    await send('Runtime.evaluate', { expression: after }, sessionId);
    await sleep(settle);
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  await send('Target.closeTarget', { targetId });
  if (camera) await send('Browser.resetPermissions');
  console.log(`docs/images/${name}.png`);
}

mkdirSync(OUT, { recursive: true });
// L'accueil avec un minuteur en cours ; les autres pages sans (il cacherait le bas de l'écran).
await shoot('tablette-accueil', `${BASE}/`, TABLET);
await call(A, 'DELETE', `/timers/${timer.id}`);
const click = (label: string) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${label}')?.click()`;
for (const [name, path] of [
  ['tablette-dashboard', '/p/lea'],
  ['tablette-dashboard-famille', '/p/famille'],
  ['tablette-semaine', '/semaine'],
  ['tablette-meteo', '/meteo'],
  ['tablette-listes', '/listes'],
  ['tablette-stock', '/stock'],
  ['tablette-transports', '/transports'],
  ['tablette-telephones', '/telephones'],
  ['tablette-nas', '/nas'],
] as const) await shoot(name, BASE + path, TABLET);
await shoot('tablette-routines', `${BASE}/routines`, TABLET, { after: click('Léa') });
// Réglage des vacances scolaires : académie de Nantes (celle du YAML fictif) et aperçu de ses prochaines vacances.
await shoot('tablette-vacances-reglages', `${BASE}/vacances`, TABLET);
// Sport de la tablette, Alex reconnu (pas de caméra sans fenêtre : la session ouverte par son visage fictif est
// présentée avec chaque requête, comme le ferait la reconnaissance).
const { token: faceToken } = (await (await fetch(`${BASE}/api/faces/identify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ embedding: FACE, real: 1, live: 1 }),
})).json()) as { token: string };
const asAlexAtTablet = `{ const f = globalThis.fetch; globalThis.fetch = (url, init = {}) =>
  f(url, String(url).includes('/api/') ? { ...init, headers: { ...init.headers, 'X-Actor-Session': '${faceToken}' } } : init); }`;
// Enregistrement automatique d'un réglage : Pyjama retiré le samedi, « Enregistré » dans le titre de la carte. Le
// front attend un visage reconnu par la caméra (absente sans fenêtre) : il se croit ici sur un téléphone, et la
// session du visage fictif d'Alex (un parent) porte l'écriture côté serveur. La routine est remise ensuite.
const asPhoneLikeAlex = `${asAlexAtTablet} { const g = globalThis.fetch; globalThis.fetch = async (url, init) => {
  const res = await g(url, init);
  if (!String(url).endsWith('/api/me')) return res;
  return new Response(JSON.stringify({ ...(await res.json()), kiosk: false }), { headers: { 'content-type': 'application/json' } });
}; }`;
await shoot('tablette-routines-enregistre', `${BASE}/routines`, TABLET, {
  init: asPhoneLikeAlex,
  after: `${click('Léa')}; setTimeout(() => document.querySelector('[aria-label="Pyjama le samedi"]')?.click(), 300)`,
  settle: 2500,
});
await call(A, 'PUT', '/routines', ROUTINES);
await shoot('tablette-sport', `${BASE}/sport/p/alex`, TABLET, { init: asAlexAtTablet });
// Vie scolaire de Léa sur le dashboard d'Alex reconnu (notes, retard à justifier, messages non lus), puis son détail.
await shoot('tablette-dashboard-parent', `${BASE}/p/alex`, TABLET, { init: asAlexAtTablet });
await shoot('tablette-vie-scolaire', `${BASE}/p/alex`, TABLET, { init: asAlexAtTablet, after: `document.querySelector('.school-life')?.click()` });
// Séance guidée : échauffement passé, premier effort.
await shoot('tablette-seance', `${BASE}/seance/p/alex`, TABLET, {
  init: asAlexAtTablet,
  after: `for (let i = 0; i < 5; i++) ${click('Passer')}`,
});
// Exercice d'un côté puis de l'autre (montées genou levé, 35 s), juste après la mi-temps : « Change de côté ! ».
await shoot('tablette-seance-cote', `${BASE}/seance/p/alex`, TABLET, {
  init: asAlexAtTablet,
  after: `for (let i = 0; i < 7; i++) ${click('Passer')}`,
  settle: 18_600,
});
// Scanner (pas de caméra sans fenêtre : codes saisis à la main) : un produit rangé, puis le café, transvasé d'habitude.
const typeCode = (code: string) => `{
  const input = document.querySelector('input[placeholder="Code-barres à la main"]');
  input.value = '${code}';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.form.requestSubmit();
}`;
const pause = 'await new Promise((r) => setTimeout(r, 250));';
await shoot('tablette-scanner', `${BASE}/scanner`, TABLET, {
  after: `(async () => { ${typeCode(DOCS_PRODUCTS.pates)} ${pause} ${click('Jeté / épuisé')}; ${pause} ${typeCode(DOCS_PRODUCTS.cafe)} })()`,
});
// Recettes : carnet, fiche, mode cuisine (tablette) ; carnet, fiche, notre version et import partagé (téléphone).
await shoot('tablette-recettes', `${BASE}/recettes`, TABLET);
await shoot('tablette-recette', `${BASE}/recette/${galettes.id}`, TABLET);
await shoot('tablette-recette-cuisine', `${BASE}/recette/${lentilles.id}/cuisine`, TABLET, { after: click('Suivante') });
await shoot('telephone-recettes', `${BASE}/m/recettes`, PHONE, { init: asPhone('alex') });
await shoot('telephone-recette', `${BASE}/m/recette/${lentilles.id}`, PHONE, { init: asPhone('alex') });
await shoot('telephone-recette-modifier', `${BASE}/m/recette/${galettes.id}/modifier`, PHONE, {
  init: asPhone('lea'),
  after: `[...document.querySelectorAll('h2, h3, legend, span, p')].find((e) => e.textContent.trim() === 'Ingrédients')?.scrollIntoView()`,
});
await shoot('telephone-recette-partage', `${BASE}/partager?text=${encodeURIComponent(`Super recette ${BLOG_URL}`)}`, PHONE, {
  init: asPhone('alex'),
  wait: 4000,
  after: `document.querySelector('form button[type=submit]')?.click()`,
  settle: 2000,
});
// Site qui refuse la lecture : le refus propose le texte copié ou la page enregistrée ; le texte partagé donne l'aperçu.
await shoot('telephone-recette-refus', `${BASE}/partager?url=${encodeURIComponent(REFUSED_URL)}`, PHONE, {
  init: asPhone('alex'),
  wait: 4000,
  after: `document.querySelector('form button[type=submit]')?.click()`,
  settle: 2000,
});
await shoot('telephone-recette-texte', `${BASE}/partager?text=${encodeURIComponent(COPIED_TEXT)}`, PHONE, { init: asPhone('alex'), wait: 5000 });
await shoot('telephone-courses', `${BASE}/m`, PHONE, { init: asPhone('alex') });
await shoot('telephone-taches', `${BASE}/m/taches`, PHONE, { init: asPhone('lea') });
await shoot('telephone-agenda', `${BASE}/m/agenda`, PHONE, { init: asPhone('lea') });
await shoot('telephone-mots', `${BASE}/m/mots`, PHONE, { init: asPhone('alex') });
// Téléphone d'un parent : la vie scolaire en tête de l'agenda, puis son détail.
await shoot('telephone-agenda-parent', `${BASE}/m/agenda`, PHONE, { init: asPhone('alex') });
await shoot('telephone-vie-scolaire', `${BASE}/m/agenda`, PHONE, { init: asPhone('alex'), after: `document.querySelector('.school-life button')?.click()` });
await shoot('telephone-stock', `${BASE}/m/stock`, PHONE, { init: asPhone('alex') });
await shoot('telephone-sport', `${BASE}/m/sport`, PHONE, { init: asPhone('alex') });
await shoot('telephone-sport-exercice', `${BASE}/m/sport`, PHONE, { init: asPhone('alex'), after: `document.querySelectorAll('.plan button')[2].click()` });
await shoot('telephone-sport-stats', `${BASE}/m/sport`, PHONE, { init: asPhone('alex'), after: click('Statistiques et tout l’historique') });
await shoot('telephone-sport-stats-progression', `${BASE}/m/sport`, PHONE, {
  init: asPhone('alex'),
  after: `${click('Statistiques et tout l’historique')}; setTimeout(() => [...document.querySelectorAll('h3')].find((h) => h.textContent === 'Temps d’effort par exercice')?.scrollIntoView(), 300)`,
});
await shoot('telephone-sport-stats-exercices', `${BASE}/m/sport`, PHONE, {
  init: asPhone('alex'),
  after: `${click('Statistiques et tout l’historique')}; setTimeout(() => [...document.querySelectorAll('h3')].find((h) => h.textContent === 'Par exercice')?.scrollIntoView(), 300)`,
});
await shoot('telephone-sport-seance', `${BASE}/m/sport`, PHONE, {
  init: asPhone('alex'),
  after: `${click('Noter la séance')}; setTimeout(() => { ${click('3Exigeant')}; document.querySelectorAll('.seg')[1].querySelectorAll('button')[2].click(); }, 300)`,
});
// Réglages du programme : élastique de tirage et sans sauts cochés, séance 1 choisie (rowing à l'élastique, jumping
// jacks sans saut à la place des jumping jacks), puis la carte des réglages. En dernier : les autres captures du
// sport gardent le programme sans réglage.
if (!only || only.test('telephone-sport-reglages')) await call(TOKENS.alex, 'PUT', '/fitness/settings', { band: true, noJump: true });
await shoot('telephone-sport-reglages', `${BASE}/m/sport`, PHONE, { init: asPhone('alex'), after: click('1') });
await shoot('telephone-sport-reglages-carte', `${BASE}/m/sport`, PHONE, {
  init: asPhone('alex'),
  after: `[...document.querySelectorAll('h2')].find((h) => h.textContent === 'Réglages du programme')?.scrollIntoView({ block: 'center' })`,
});
// Scanner du téléphone, produit encore devant la caméra : un faux lecteur voit sans fin le même paquet de pâtes, qui
// n'est compté qu'une fois ; le bandeau demande de le retirer.
const fakeDetector = `globalThis.BarcodeDetector = class {
  static async getSupportedFormats() { return ['ean_13', 'ean_8', 'upc_a', 'upc_e']; }
  async detect() { return [{ rawValue: '${DOCS_PRODUCTS.pates}', format: 'ean_13' }]; }
};`;
await shoot('telephone-scanner', `${BASE}/m/scanner`, PHONE, { init: asPhone('alex') + fakeDetector, camera: true, wait: 4000 });

// --- Vacances scolaires (calendrier d'exemple, zone B) : serveur et navigateur relancés à d'autres dates, même état.
// Lundi 7 décembre : la puce annonce les vacances de Noël ; lundi 21 décembre : vacances, plus de bus ni de cours,
// routine sans « Cartable » (jours d'école), agenda du téléphone. Mercredi 11 novembre : jour férié, traité pareil.
if (!only || only.test('vacances') || only.test('ferie')) {
  for (const [now, captures] of [
    [DOCS_BEFORE_HOLIDAYS, [['tablette-vacances-bientot', '/p/lea', TABLET, '']]],
    [DOCS_HOLIDAYS, [
      ['tablette-vacances', '/', TABLET, ''],
      ['tablette-vacances-dashboard', '/p/lea', TABLET, ''],
      ['telephone-agenda-vacances', '/m/agenda', PHONE, asPhone('lea')],
    ]],
    [DOCS_PUBLIC_HOLIDAY, [['tablette-ferie-dashboard', '/p/lea', TABLET, '']]],
  ] as const) {
    browserNow = now;
    await startServer(now);
    for (const [name, path, metrics, init] of captures) await shoot(name, BASE + path, metrics, { init });
  }
  browserNow = DOCS_NOW;
}

// --- Planche du design :variables de web/src/app.css, profils de la configuration fictive.
const appCss = readFileSync(join(ROOT, 'web', 'src', 'app.css'), 'utf8');
const rootBlock = /:root\s*\{[\s\S]*?\n\}/.exec(appCss)?.[0] ?? '';
const members = (parse(readFileSync(join(HERE, 'homehub.yaml'), 'utf8')) as { members: { name: string; color: string }[] }).members
  .map(({ name, color }) => ({ name, color }));
const planche = join(work, 'planche.html');
writeFileSync(planche, readFileSync(join(HERE, 'planche.html'), 'utf8')
  .replace('/*TOKENS*/', rootBlock)
  .replace('/*MEMBERS*/[]', JSON.stringify(members)));
await shoot('planche-design', pathToFileURL(planche).href, { width: 1280, height: 1130, deviceScaleFactor: 1, mobile: false }, { wait: 500 });

await send('Browser.close').catch(() => null);
socket.close();
await cleanup();
