// Refait les captures de la doc (docs/images/) : HomeHub lancé dans un monde fictif (scripts/docs-captures/),
// rempli de données d'exemple, photographié par Chrome sans fenêtre (protocole DevTools, sans dépendance).
// À lancer depuis le dossier du repo, après `npm run build` :
//   node scripts/docs-captures.ts            toutes les captures et la planche du design
//   node scripts/docs-captures.ts <regex>    seulement les captures dont le nom correspond (ex. « telephone »)
// Chrome est cherché aux emplacements habituels ; sinon : CHROME=<chemin> node scripts/docs-captures.ts
// Rien de réel : famille de test, faux ÉcoleDirecte, faux temps réel Irigo ; seule la météo est la vraie du jour.
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { DOCS_NOW } from './docs-captures/fake-world.ts';

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
const nas = JSON.parse(readFileSync(join(ROOT, 'server', 'sources', 'fixtures', 'nas-status.json'), 'utf8'));
nas.generatedAt = new Date(DOCS_NOW - 5 * 60_000).toISOString();
writeFileSync(join(work, 'nas-status.json'), JSON.stringify(nas));

const children: ChildProcess[] = [];
/** Arrête Chrome et le serveur, attend qu'ils aient lâché leurs fichiers, puis efface le dossier de travail. */
async function cleanup(): Promise<void> {
  await Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => {
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

// --- Serveur.
const server = spawn(process.execPath, [join(HERE, 'server.ts')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOMEHUB_CONFIG: join(HERE, 'homehub.yaml'),
    HOMEHUB_STATE_DIR: state,
    HOMEHUB_NAS_STATUS: join(work, 'nas-status.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(server);
let serverLog = '';
server.stdout?.on('data', (d) => (serverLog += d));
server.stderr?.on('data', (d) => (serverLog += d));
for (let i = 0; ; i++) {
  if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) break;
  if (i > 60) throw new Error(`le serveur ne répond pas :\n${serverLog}`);
  await sleep(500);
}

// --- Données d'exemple, écrites par les téléphones (un parent écrit partout, Léa sur son profil).
async function call(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} : ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
const A = TOKENS.alex;
const L = TOKENS.lea;
const steps = (prefix: string, labels: string[]) => labels.map((label, i) => ({ id: `${prefix}${i}`, label, days: null }));
await call(A, 'PUT', '/routines', {
  windows: { morning: { from: '05:00', to: '11:00' }, evening: { from: '17:00', to: '23:00' } },
  members: {
    alex: { morning: [], evening: [] },
    sam: { morning: [], evening: [] },
    lea: { morning: steps('lm', ['S’habiller', 'Petit-déjeuner', 'Dents', 'Cartable']), evening: steps('le', ['Douche', 'Pyjama', 'Devoirs']) },
    tom: { morning: steps('tm', ['S’habiller', 'Petit-déjeuner', 'Dents']), evening: steps('te', ['Bain', 'Pyjama', 'Histoire']) },
  },
});
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

// --- Chrome sans fenêtre, piloté par le protocole DevTools (WebSocket natif de Node).
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${PORT + 1}`, `--user-data-dir=${join(work, 'chrome')}`,
  '--no-first-run', '--hide-scrollbars', '--lang=fr-FR', '--force-color-profile=srgb', 'about:blank',
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
const fakeClock = `(() => {
  const offset = ${DOCS_NOW} - Date.now(); const R = Date;
  class F extends R { constructor(...a) { a.length ? super(...a) : super(R.now() + offset); } static now() { return R.now() + offset; } }
  globalThis.Date = F; })();`;
const asPhone = (ownerId: keyof typeof TOKENS) =>
  `localStorage.setItem('homehub.phone', JSON.stringify({ token: '${TOKENS[ownerId]}', ownerId: '${ownerId}' }));`;

async function shoot(name: string, url: string, metrics: Metrics, { init = '', after = '', wait = 3000 } = {}) {
  if (only && !only.test(name)) return;
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', metrics, sessionId);
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Paris' }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeClock + init }, sessionId);
  const loaded = new Promise<void>((r) => listeners.push((m) => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && r()));
  await send('Page.navigate', { url }, sessionId);
  await loaded;
  await sleep(wait);
  if (after) {
    await send('Runtime.evaluate', { expression: after }, sessionId);
    await sleep(1000);
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  await send('Target.closeTarget', { targetId });
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
  ['tablette-transports', '/transports'],
  ['tablette-telephones', '/telephones'],
  ['tablette-nas', '/nas'],
] as const) await shoot(name, BASE + path, TABLET);
await shoot('tablette-routines', `${BASE}/routines`, TABLET, { after: click('Léa') });
await shoot('telephone-courses', `${BASE}/m`, PHONE, { init: asPhone('alex') });
await shoot('telephone-taches', `${BASE}/m/taches`, PHONE, { init: asPhone('lea') });
await shoot('telephone-agenda', `${BASE}/m/agenda`, PHONE, { init: asPhone('lea') });
await shoot('telephone-mots', `${BASE}/m/mots`, PHONE, { init: asPhone('alex') });

// --- Planche du design : variables de web/src/app.css, profils de la configuration fictive.
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
