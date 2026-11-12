// Essai de l'extension « Remplir le panier » dans le monde fictif, sans jamais toucher au vrai site : Chrome sans
// fenêtre ouvre des adresses www.coursesu.com, mais chaque requête est interceptée (protocole DevTools, Fetch) et
// servie par la fausse enseigne (scripts/docs-captures/fake-drive.ts). Le script de page construit
// (extension/dist/content.js) y est injecté avec un faux `chrome.storage`, et on vérifie, au rythme réel de
// l'extension : remplissage complet (ajouts, indisponible passé, déjà au panier), arrêt au captcha, arrêt quand le site
// ne confirme pas l'ajout, arrêt sur une page inattendue. Refait aussi les captures « ordinateur-extension-* ».
// À lancer depuis le dossier du repo : `npm run extension:check` (construit l'extension d'abord). Dure environ 2 min.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CART_KIND, type DriveCart } from '../shared/drive-cart.ts';
import { lineUrl, newRun, type Run, startRun } from '../extension/src/run.ts';
import { challengePage, DRIVE_CART_URL, driveProduct, fakeDriveSite } from './docs-captures/fake-drive.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'extension', 'dist');
const OUT = join(ROOT, 'docs', 'images');
const PORT = 3192;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(DIST, 'content.js'))) {
  console.error('Extension non construite : lancer d’abord npm run build:extension');
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
  console.error('Chrome introuvable : CHROME=<chemin> node scripts/extension-check.ts');
  process.exit(1);
}

// --- Faux `chrome.*` de l'extension : stockage dans le stockage local du (faux) site, qui survit d'une fiche à l'autre.
const SHIM = `(() => {
  const KEY = '__homehub_extension';
  const read = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const listeners = [];
  const local = {
    async get(keys) { const all = read(); return Object.fromEntries([].concat(keys).filter((k) => k in all).map((k) => [k, all[k]])); },
    async set(items) {
      const all = read(); const changes = {};
      for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: all[k], newValue: v }; all[k] = v; }
      localStorage.setItem(KEY, JSON.stringify(all)); listeners.forEach((l) => l(changes, 'local'));
    },
    async remove(keys) { const all = read(); const changes = {}; for (const k of [].concat(keys)) { changes[k] = { oldValue: all[k] }; delete all[k]; } localStorage.setItem(KEY, JSON.stringify(all)); listeners.forEach((l) => l(changes, 'local')); },
  };
  Object.defineProperty(window, 'chrome', { configurable: true, value: {
    storage: { local, onChanged: { addListener: (l) => listeners.push(l) } },
    tabs: { query: async () => [{ id: 1, url: location.href }], update: async (id, p) => { location.assign(p.url); return { id }; } },
    permissions: { contains: async () => true, request: async () => true },
  } });
})();`;
const content = readFileSync(join(DIST, 'content.js'), 'utf8');
// Comme `run_at: document_idle` : le script de page part une fois la page chargée.
const INJECT = `${SHIM}\naddEventListener('load', () => {\n${content}\n});`;

// --- Chrome sans fenêtre, protocole DevTools.
const work = mkdtempSync(join(tmpdir(), 'homehub-extension-'));
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(work, 'chrome')}`, '--no-first-run', '--hide-scrollbars', '--lang=fr-FR', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
let wsUrl = '';
for (let i = 0; !wsUrl; i++) {
  if (i > 60) throw new Error('Chrome ne répond pas');
  await sleep(250);
  wsUrl = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl, () => '');
}
const socket = new WebSocket(wsUrl);
await new Promise((r) => socket.addEventListener('open', r, { once: true }));
type Message = { id?: number; method?: string; sessionId?: string; params?: any; result?: unknown; error?: unknown };
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

const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };

/** Onglet dont les requêtes vers le site de l'enseigne sont servies par le faux site (`override` : page imposée). */
async function openTab(override: (url: URL) => string | null = () => null, metrics = DESKTOP) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', metrics, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.coursesu.com/*' }, { urlPattern: 'https://coursesu.com/*' }] }, sessionId);
  listeners.push(async (m) => {
    if (m.sessionId !== sessionId || m.method !== 'Fetch.requestPaused') return;
    const url = new URL(m.params.request.url);
    const forced = override(url);
    const response = forced ? new Response(forced, { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } }) : fakeDriveSite(url);
    const body = Buffer.from(await response.arrayBuffer()).toString('base64');
    const responseHeaders = [...response.headers].map(([name, value]) => ({ name, value }));
    await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: response.status, responseHeaders, body }, sessionId).catch(() => null);
  });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT }, sessionId);
  const evaluate = async (expression: string) => (await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId).catch(() => null))?.result?.value;
  const shot = async (name: string) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`  docs/images/${name}.png`);
  };
  const navigate = async (url: string) => {
    const loaded = new Promise<void>((r) => listeners.push((m) => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && r()));
    await send('Page.navigate', { url }, sessionId);
    await loaded;
  };
  return { targetId, sessionId, evaluate, shot, navigate, close: () => send('Target.closeTarget', { targetId }) };
}

type Tab = Awaited<ReturnType<typeof openTab>>;
const readRun = async (tab: Tab) => {
  const raw = (await tab.evaluate(`localStorage.getItem('__homehub_extension')`)) as string | null | undefined;
  return raw ? ((JSON.parse(raw) as { run?: Run }).run ?? null) : null;
};

/** Lance un remplissage comme le panneau : panier lu, remplissage commencé, première fiche ouverte dans l'onglet. */
async function fill(tab: Tab, lines: { slug?: string; url?: string; id?: string; name?: string; count: number }[], { fakeCart = {}, refuse = false } = {}) {
  const cart: DriveCart = {
    kind: CART_KIND,
    version: 1,
    enseigne: 'coursesu',
    store: 'Super U Exemple',
    lines: lines.map((l, i) => {
      const product = l.slug ? driveProduct(l.slug) : { id: l.id!, name: l.name!, url: l.url! };
      return { itemId: `article-${i + 1}`, label: product.name.split(' ')[0], ...product, count: l.count };
    }),
  };
  const run = startRun(newRun(cart, `essai-${Date.now()}`, new Date()), new Date());
  await tab.navigate(DRIVE_CART_URL);
  await tab.evaluate(`localStorage.clear();
    localStorage.setItem('faux-drive-panier', ${JSON.stringify(JSON.stringify(fakeCart))});
    ${refuse ? `localStorage.setItem('faux-drive-refus', '1');` : ''}
    localStorage.setItem('__homehub_extension', ${JSON.stringify(JSON.stringify({ run }))});`);
  await tab.navigate(lineUrl(run)!);
}

/** Attend la fin (ou l'arrêt) du remplissage ; `during` est appelé à chaque relevé. */
async function finish(tab: Tab, during: (run: Run) => Promise<void> = async () => {}, timeout = 120_000): Promise<Run> {
  for (let waited = 0; waited < timeout; waited += 500) {
    const run = await readRun(tab);
    if (run) await during(run);
    if (run && (run.phase === 'done' || run.phase === 'stopped')) return run;
    await sleep(500);
  }
  throw new Error('Le remplissage ne s’est pas terminé à temps');
}

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}
const statuses = (run: Run) => run.lines.map((l) => `${l.status}:${l.inCart}`);

try {
  console.log('Remplissage complet (ajouts, indisponible passé, déjà au panier)');
  let tab = await openTab();
  await fill(tab, [{ slug: 'gruyere-rape-exemple', count: 2 }, { slug: 'lessive-liquide-exemple', count: 1 }, { slug: 'farine-ble-exemple', count: 1 }, { slug: 'thon-naturel-exemple', count: 1 }], {
    fakeCart: { 9990015: { name: 'Thon au naturel Pêcheries de l’Ouest, 3x52g', qty: 1, price: '3.15' } },
  });
  let midShot = false;
  let run = await finish(tab, async (r) => {
    // Capture en cours de route : le gruyère vient d'être ajouté, la lessive est la suivante.
    if (!midShot && r.index === 1) {
      midShot = true;
      await tab.shot('ordinateur-extension-ajout');
    }
  });
  check('fini', run.phase === 'done', run.phase);
  check('statuts et paquets au panier', JSON.stringify(statuses(run)) === JSON.stringify(['added:2', 'added:1', 'skipped:0', 'already:1']), statuses(run));
  check('prix et EAN lus dans la page', run.lines[0].price === 2.35 && run.lines[0].ean === '3000000000106' && run.lines[1].price === 7.9, run.lines.map((l) => [l.price, l.ean]));
  const fakeCart = JSON.parse(((await tab.evaluate(`localStorage.getItem('faux-drive-panier')`)) as string) ?? '{}') as Record<string, { qty: number }>;
  check('panier du faux site', fakeCart['9990012']?.qty === 2 && fakeCart['9990014']?.qty === 1 && fakeCart['9990015']?.qty === 1 && !fakeCart['9990017'], fakeCart);
  await sleep(1500);
  await tab.navigate(DRIVE_CART_URL);
  await sleep(2500);
  await tab.shot('ordinateur-extension-fini');
  await tab.close();
  const finished = run;

  console.log('Arrêt au captcha');
  tab = await openTab((url) => (url.pathname.includes('oignons') ? challengePage() : null));
  await fill(tab, [{ slug: 'gruyere-rape-exemple', count: 1 }, { slug: 'oignons-jaunes-exemple', count: 1 }, { slug: 'lessive-liquide-exemple', count: 1 }]);
  run = await finish(tab);
  check('arrêté', run.phase === 'stopped' && /Captcha|vérifie/u.test(run.stop ?? ''), [run.phase, run.stop]);
  check('ajouté avant, échec sur la fiche, rien après', JSON.stringify(statuses(run)) === JSON.stringify(['added:1', 'failed:0', 'waiting:0']), statuses(run));
  await sleep(2500);
  await tab.shot('ordinateur-extension-arret');
  await tab.close();

  console.log('Arrêt quand le site ne confirme pas l’ajout');
  tab = await openTab();
  await fill(tab, [{ slug: 'gruyere-rape-exemple', count: 1 }, { slug: 'lessive-liquide-exemple', count: 1 }], { refuse: true });
  run = await finish(tab);
  check('arrêté sans réponse du site', run.phase === 'stopped' && /pas confirmé/u.test(run.stop ?? ''), [run.phase, run.stop]);
  check('rien ajouté, rien après', JSON.stringify(statuses(run)) === JSON.stringify(['failed:0', 'waiting:0']), statuses(run));
  await tab.close();

  console.log('Arrêt sur une page inattendue (fiche introuvable)');
  tab = await openTab();
  await fill(tab, [{ url: 'https://www.coursesu.com/p/produit-retire-exemple/9990098.html', id: '9990098', name: 'Produit retiré', count: 1 }, { slug: 'gruyere-rape-exemple', count: 1 }]);
  run = await finish(tab);
  check('arrêté', run.phase === 'stopped' && /Page inattendue/u.test(run.stop ?? ''), [run.phase, run.stop]);
  await tab.close();

  // Le panneau de l'extension à la fin du premier remplissage (compte rendu à copier).
  console.log('Panneau de l’extension');
  const popup = join(work, 'popup.html');
  writeFileSync(
    popup,
    readFileSync(join(DIST, 'popup.html'), 'utf8')
      .replace('<script src="popup.js"></script>', `<script>${SHIM.replace("localStorage.getItem(KEY) || '{}'", `localStorage.getItem(KEY) || ${JSON.stringify(JSON.stringify({ run: finished }))}`)}</script><script src="${pathToFileURL(join(DIST, 'popup.js')).href}"></script>`),
  );
  tab = await openTab(() => null, { width: 412, height: 640, deviceScaleFactor: 2, mobile: false });
  await tab.navigate(pathToFileURL(popup).href);
  await sleep(1000);
  const text = String(await tab.evaluate('document.body.innerText'));
  check('compte rendu proposé', text.includes('Copier le compte rendu') && text.includes('Indisponible au magasin choisi'), text.slice(0, 200));
  await tab.shot('ordinateur-extension-panneau');
  await tab.close();
} finally {
  await send('Browser.close').catch(() => null);
  socket.close();
  chrome.kill();
  await sleep(500);
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}

console.log(failures ? `${failures} vérification(s) en échec` : 'Extension : tout est bon');
process.exit(failures ? 1 : 0);
