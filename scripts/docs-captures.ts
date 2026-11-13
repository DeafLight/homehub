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
import { itemKey } from '../shared/drive.ts';
import { DRIVE_REFUSED_URL, driveProduct, driveUrl } from './docs-captures/fake-drive.ts';
import { BLOG_URL, COPIED_TEXT, recipeUrl, REFUSED_URL } from './docs-captures/fake-recipes.ts';
import { DOCS_BEFORE_HOLIDAYS, DOCS_HOLIDAYS, DOCS_NOW, DOCS_PUBLIC_HOLIDAY, DOCS_FOOD, DOCS_FRESH, DOCS_PRODUCTS, DOCS_UNKNOWN } from './docs-captures/fake-world.ts';

const ROOT = resolve(import.meta.dirname, '..');
const HERE = join(ROOT, 'scripts', 'docs-captures');
const OUT = join(ROOT, 'docs', 'images');
// DOCS_PORT : autre port (une autre copie du dépôt a déjà son monde fictif ouvert sur 3190).
const PORT = Number(process.env.DOCS_PORT) || 3190;
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
  // Port déjà pris (captures d'une autre copie du dépôt) : s'arrêter, sinon on écrirait dans son monde fictif.
  if (!server && (await fetch(`${BASE}/api/health`).then(() => true, () => false))) throw new Error(`port ${PORT} déjà occupé par un autre serveur HomeHub : attendre qu'il s'arrête`);
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
// Sans code-barres : des pommes du marché (au poids), une botte de radis, une soupe faite maison.
for (const loose of [
  { name: 'Pommes', category: 'Fruits et légumes', amount: 1.2, unit: 'kg' },
  { name: 'Radis', category: 'Fruits et légumes', amount: 1, unit: 'botte' },
  { name: 'Soupe de potiron maison', category: 'Frais', amount: 1, unit: 'l' },
]) await call(A, 'POST', '/stock/loose', loose);
// Dates de péremption (aujourd'hui : jeudi 5 novembre) : yaourts jusqu'à lundi 9, jambon jusqu'à aujourd'hui, deux pots
// de crème fraîche (l'un passé d'hier, l'autre du 20), des biscottes de préférence avant le 30 ; un pot de crème
// périmé du 2 déjà jeté ce mois-ci (« 1 produit jeté (périmé) »). Les pommes, radis et la soupe (sans date) ont une
// date estimée d'après leur rayon.
for (const code of Object.values(DOCS_FRESH)) await call(A, 'GET', `/stock/scan/${code}`);
for (const [code, category] of [[DOCS_FRESH.yaourts, 'Crèmerie'], [DOCS_FRESH.creme, 'Crèmerie'], [DOCS_FRESH.jambon, 'Boucherie'], [DOCS_FRESH.biscottes, 'Épicerie']] as const) {
  const { product } = (await call(A, 'GET', `/stock/scan/${code}`)) as { product: { current: Record<string, unknown> } };
  const { name, brand, quantity } = product.current;
  await call(A, 'PUT', `/stock/products/${code}`, { name, brand, quantity, category });
}
await call(A, 'POST', '/stock/in', { code: DOCS_FRESH.creme, count: 1, date: day(-3), kind: 'dlc' });
await call(A, 'POST', '/stock/out', { code: DOCS_FRESH.creme });
for (const [code, count, date, kind] of [
  [DOCS_FRESH.yaourts, 4, day(4), 'dlc'],
  [DOCS_FRESH.jambon, 2, day(0), 'dlc'],
  [DOCS_FRESH.creme, 1, day(-1), 'dlc'],
  [DOCS_FRESH.creme, 1, day(15), 'dlc'],
  [DOCS_FRESH.biscottes, 1, day(25), 'ddm'],
] as const) await call(L, 'POST', '/stock/in', { code, count, date, kind });

// Carnet de recettes : trois recettes importées du faux site (cuisine.exemple.test), une saisie à la main ; notre
// version des galettes modifiée (astuce, beurre demi-sel corrigé à la main, ingrédients et étapes rangés en groupes).
type Imported = { recipe: { id: string; ours: { ingredients: { text: string }[]; steps: { text: string }[] } & Record<string, unknown> } };
const lentilles = ((await call(A, 'POST', '/recipes/import', { url: recipeUrl('mijote-lentilles-cookeo') })) as Imported).recipe;
const galettes = ((await call(L, 'POST', '/recipes/import', { url: recipeUrl('galettes-sarrasin') })) as Imported).recipe;
await call(A, 'POST', '/recipes/import', { url: `Regarde ça : ${recipeUrl('riz-saute-legumes')}` });
await call(A, 'PUT', `/recipes/${galettes.id}`, {
  content: {
    ...galettes.ours,
    ingredients: [
      ...galettes.ours.ingredients.map((l) =>
        l.text.startsWith('Beurre') ? { ...l, text: 'Beurre demi-sel pour la poêle', name: 'beurre demi-sel', manual: true, section: 'Pour la cuisson' } : { ...l, section: 'Pour la pâte' },
      ),
      { text: '50 g de gruyère râpé', section: 'Pour la cuisson' },
    ],
    steps: galettes.ours.steps.map((s, i) => ({ ...s, section: i < 3 ? 'La pâte, la veille' : 'Cuisson' })),
    tips: 'La pâte est meilleure préparée la veille. Garniture du dimanche : jambon, emmental et un œuf au plat.',
  },
});
const fromBlog = (await call(A, 'POST', '/recipes/import', { url: BLOG_URL })) as { draft?: unknown };
if (!fromBlog.draft) throw new Error('import du blog : brouillon attendu');
await call(A, 'POST', '/recipes', {
  content: {
    title: 'Pâtes au thon de Sam',
    servings: 4,
    ingredients: ['400 g de pâtes', '1 boîte de thon au naturel', '1 brique de crème fraîche', '1 citron', '60 g de gruyère râpé', 'Persil'].map((text) => ({ text })),
    steps: ['Cuire les pâtes 10 minutes.', 'Mélanger le thon émietté, la crème et le jus du citron, ajouter aux pâtes égouttées.', 'Parsemer de persil.'].map((text) => ({ text })),
    tips: 'Les enfants les préfèrent sans persil.',
  },
});

// Notes de la famille : sur les galettes (une ouverte de Léa, une d'Alex, une résolue), sur le mijoté (deux ouvertes,
// rappelées dans le mode cuisine).
type Note = { id: string };
const galettesNotes = `/recipes/${galettes.id}/notes`;
const salt = (await call(A, 'POST', galettesNotes, { text: 'Moins salé la prochaine fois : beurre doux dans la pâte.' })) as Note;
await call(A, 'PATCH', `${galettesNotes}/${salt.id}`, { resolved: true });
await call(L, 'POST', galettesNotes, { text: 'Tom n’aime pas les champignons : en garder sans pour lui.' });
await call(A, 'POST', galettesNotes, { text: 'Pâte un peu épaisse : ajouter 5 cl de lait.' });
await call(A, 'POST', `/recipes/${lentilles.id}/notes`, { text: 'Moins de cumin, les enfants l’ont trouvé fort.' });
await call(L, 'POST', `/recipes/${lentilles.id}/notes`, { text: 'Super avec du riz !' });

// Menu de la semaine (celle du jeudi 5 novembre) : quatre recettes, dont les pâtes au thon de mardi, pas encore notées
// cuisinées (rappel discret sur l'accueil et dans le menu) ; trois produits du placard
// reliés aux ingrédients (lentilles en stock en quantité suffisante, carottes au kilo contre des carottes à la pièce :
// à vérifier, et un seul paquet de gruyère râpé, qui s'utilise en plusieurs fois, pour les galettes et les pâtes :
// « à vérifier au placard », 160 g arrondis à un paquet de 200 g), les coquillettes et le thon (deviné d'après sa
// catégorie Open Food Facts) encore à relier ; les œufs cochés
// « j'en ai déjà ». « Lait » et « Pâtes » sont déjà sur la liste, écrits à la main : ils l'emportent sur les lignes du menu.
type Summary = { id: string; title: string };
const carnet = ((await call(A, 'GET', '/recipes')) as { recipes: Summary[] }).recipes;
const recipeId = (start: string) => carnet.find((r) => r.title.startsWith(start))!.id;
const WEEK = '2026-11-02';
for (const [start, people, day] of [
  ['Mijoté', 4, '2026-11-05'],
  ['Riz sauté', 4, '2026-11-06'],
  ['Galettes', 24, '2026-11-08'],
  ['Pâtes au thon', 4, '2026-11-03'],
] as const) await call(A, 'POST', '/menu/entries', { week: WEEK, recipeId: recipeId(start), people, day });
for (const code of Object.values(DOCS_FOOD)) await call(A, 'GET', `/stock/scan/${code}`);
await call(A, 'POST', '/stock/in', { code: DOCS_FOOD.lentilles, count: 2, price: 2.1 });
await call(A, 'POST', '/stock/in', { code: DOCS_FOOD.carottes, count: 1, price: 1.6 });
await call(A, 'POST', '/stock/in', { code: DOCS_FOOD.gruyere, count: 1, price: 2.4 });
// Boîte de thon au nom sans indice : proposée pour le thon d'après sa catégorie Open Food Facts, pas encore reliée.
await call(A, 'POST', '/stock/in', { code: DOCS_FOOD.thon, count: 2, price: 1.9 });
await call(A, 'PUT', `/menu/links/${DOCS_FOOD.gruyere}`, { link: { key: 'gruyere', name: 'gruyère', per: { quantity: 200, unit: 'g' } } });

await call(A, 'PUT', `/menu/links/${DOCS_FOOD.lentilles}`, { link: { key: 'lentille-verte', name: 'lentille verte', per: { quantity: 500, unit: 'g' } } });
await call(A, 'PUT', `/menu/links/${DOCS_FOOD.carottes}`, { link: { key: 'carotte', name: 'carotte', per: { quantity: 1, unit: 'kg' } } });
await call(A, 'PUT', '/menu/have', { week: WEEK, key: 'oeuf', have: true });

// Drive : Courses U et un magasin d'exemple ; produits retenus (fiches inventées, lues sur le faux site) pour le gruyère
// (avec un secours, le grand paquet), les oignons et la lessive. Le thon reste à relier (capture du partage).
await call(A, 'PUT', '/drive/settings', { enseigne: 'coursesu', store: { name: 'Super U Exemple', url: null } });
for (const [label, slug, role] of [
  ['Gruyère', 'gruyere-rape-exemple', 'preferred'],
  ['Gruyère', 'gruyere-rape-grand-exemple', 'fallback'],
  ['Oignon', 'oignons-jaunes-exemple', 'preferred'],
  ['Lessive', 'lessive-liquide-exemple', 'preferred'],
] as const) {
  const { product } = (await call(A, 'POST', '/drive/read', { url: driveUrl(slug) })) as { product: Record<string, unknown> };
  await call(A, 'PUT', '/drive/choices', { key: itemKey({ label }), label, role, product: { ...product, source: 'page' } });
}
// Panier en cours : la lessive est déjà mise au panier de l'enseigne (marquée « au drive » dans les courses).
{
  const { shopping } = (await call(A, 'GET', '/lists')) as { shopping: { id: string; label: string }[] };
  const lessive = shopping.find((i) => i.label.startsWith('Lessive'));
  if (lessive) await call(A, 'PUT', `/drive/basket/${lessive.id}`, { in: true });
  // Compte rendu de l'extension « Remplir le panier » recollé : prix vus sur les fiches de la lessive (déjà au panier)
  // et du gruyère, que l'extension a trouvé en rupture : il reste dans la liste, signalé, avec son secours (le grand
  // paquet) proposé en remplacement, jamais pris d'office.
  const gruyere = shopping.find((i) => i.label.startsWith('Gruyère'));
  const seen = (slug: string, itemId: string, status: string, count: number, price: number, note: string | null = null) => ({ itemId, ...driveProduct(slug), status, count, ean: null, price, note });
  if (lessive && gruyere) {
    await call(A, 'POST', '/drive/report', {
      kind: 'homehub-drive-report', version: 1, enseigne: 'coursesu', at: new Date(DOCS_NOW).toISOString(), stop: null,
      lines: [seen('lessive-liquide-exemple', lessive.id, 'already', 1, 7.9), seen('gruyere-rape-exemple', gruyere.id, 'skipped', 0, 2.35, 'Indisponible au magasin choisi')],
    });
  }
}

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
  // Fausse caméra (mire animée) et faux micro, autorisés seulement pour le scanner du téléphone (voir `camera`) et la
  // caméra en direct. Candidats WebRTC sans nom mDNS : la tablette et le téléphone se joignent sur la même machine.
  '--use-fake-device-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns', 'about:blank',
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

/** Onglet ouvert sur `url` (avec l'horloge fictive et `init` avant le chargement), à capturer puis fermer. */
async function openTarget(url: string, metrics: Metrics, init = '') {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', metrics, sessionId);
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Paris' }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeClock() + init }, sessionId);
  const loaded = new Promise<void>((r) => listeners.push((m) => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && r()));
  await send('Page.navigate', { url }, sessionId);
  await loaded;
  return {
    evaluate: (expression: string) => send('Runtime.evaluate', { expression, returnByValue: true }, sessionId),
    async capture(name: string) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
      console.log(`docs/images/${name}.png`);
    },
    close: () => send('Target.closeTarget', { targetId }),
  };
}

async function shoot(name: string, url: string, metrics: Metrics, { init = '', after = '', wait = 3000, settle = 1000, camera = false } = {}) {
  if (only && !only.test(name)) return;
  if (camera) await send('Browser.grantPermissions', { origin: BASE, permissions: ['videoCapture'] });
  const target = await openTarget(url, metrics, init);
  await sleep(wait);
  if (after) {
    await target.evaluate(after);
    await sleep(settle);
  }
  await target.capture(name);
  await target.close();
  if (camera) await send('Browser.resetPermissions');
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
// Ajout d'un produit sans code-barres sur la tablette : des œufs de la ferme, 6 pièces, rayon Frais (non validé).
const typeInto = (selector: string, text: string) =>
  `{ const i = document.querySelector('${selector}'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '${text}'); i.dispatchEvent(new Event('input', { bubbles: true })); }`;
await shoot('tablette-stock-sans-code-barres', `${BASE}/stock`, TABLET, {
  after: `${click('Sans code-barres')}; setTimeout(() => { ${typeInto('[role=dialog] input[required]', 'Œufs de la ferme')} ${typeInto('[role=dialog] input[inputmode=decimal]', '6')} ${click('pièces')}; ${click('Frais')}; document.activeElement?.blur(); }, 300)`,
});
// Drive, étape 2 : « Remplir le panier » sur la tablette (ouvert depuis les courses).
await shoot('tablette-drive-panier', `${BASE}/listes`, TABLET, { after: click('Remplir le panier') });
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
// Dates de péremption : le filtre « À consommer » (tablette, téléphone d'Alex) et le réglage des seuils et des durées.
const stockFilter = (label: string) => `[...document.querySelectorAll('.filters button')].find((b) => b.textContent.startsWith('${label}'))?.click()`;
await shoot('tablette-stock-a-consommer', `${BASE}/stock`, TABLET, { after: stockFilter('À consommer') });
await shoot('tablette-stock-dates-reglage', `${BASE}/stock`, TABLET, {
  after: `[...document.querySelectorAll('h2')].find((h) => h.textContent === 'Dates de péremption')?.scrollIntoView({ block: 'center' }); ${click('Régler')}`,
});
await shoot('telephone-stock-a-consommer', `${BASE}/m/stock`, PHONE, { init: asPhone('alex'), after: stockFilter('À consommer') });
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
// Menu de la semaine : recettes par jour et courses du menu (tablette, téléphone), ajout d'une recette (personnes et
// jour), et les produits du stock à relier aux ingrédients.
await shoot('tablette-menu', `${BASE}/menu`, TABLET);
await shoot('telephone-menu', `${BASE}/m/menu`, PHONE, { init: asPhone('alex') });
// Gruyère « à vérifier au placard » (un paquet peut-être entamé), vu par Léa : lecture seule, sans les boutons.
await shoot('telephone-menu-placard', `${BASE}/m/menu`, PHONE, {
  init: asPhone('lea'),
  after: `document.querySelector('.check')?.scrollIntoView({ block: 'start' })`,
});
await shoot('telephone-menu-ajout', `${BASE}/m/menu`, PHONE, {
  init: asPhone('alex'),
  after: `${click('Recette')}; setTimeout(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.includes('Galettes'))?.click(), 300)`,
});
await shoot('telephone-menu-stock', `${BASE}/m/menu`, PHONE, {
  init: asPhone('alex'),
  // Ouvre « Stock et ingrédients » et descend aux produits déjà reliés (gruyère : « s'utilise en plusieurs fois »).
  after: `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('à relier'))?.click(); setTimeout(() => [...document.querySelectorAll('[role=dialog] h3')].find((h) => h.textContent.includes('Déjà reliés'))?.scrollIntoView({ block: 'start' }), 400)`,
});
// Propositions à confirmer : le thon (« Miettes au naturel ») deviné d'après sa catégorie Open Food Facts.
await shoot('telephone-menu-stock-categorie', `${BASE}/m/menu`, PHONE, {
  init: asPhone('alex'),
  after: `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('à relier'))?.click(); setTimeout(() => [...document.querySelectorAll('[role=dialog] h3')].find((h) => h.textContent.includes('À confirmer'))?.scrollIntoView({ block: 'start' }), 400)`,
});
await shoot('telephone-recettes', `${BASE}/m/recettes`, PHONE, { init: asPhone('alex') });
await shoot('telephone-recette', `${BASE}/m/recette/${lentilles.id}`, PHONE, { init: asPhone('alex') });
// Notes de la famille sur les galettes, vues par Léa : les siennes se modifient, celles d'Alex se lisent seulement.
await shoot('telephone-recette-notes', `${BASE}/m/recette/${galettes.id}`, PHONE, {
  init: asPhone('lea'),
  after: `document.querySelector('.notes-box')?.scrollIntoView({ block: 'start' }); ${click('1 note résolue')}`,
});
await shoot('telephone-recette-modifier', `${BASE}/m/recette/${galettes.id}/modifier`, PHONE, {
  init: asPhone('lea'),
  after: `[...document.querySelectorAll('h2, h3, legend, span, p')].find((e) => e.textContent.trim() === 'Ingrédients')?.scrollIntoView()`,
});
// Groupes des étapes dans notre version : titres modifiables, choix du groupe de chaque étape, nouveau groupe.
await shoot('telephone-recette-groupes', `${BASE}/m/recette/${galettes.id}/modifier`, PHONE, {
  init: asPhone('lea'),
  after: `[...document.querySelectorAll('h2')].find((e) => e.textContent.trim() === 'Étapes')?.scrollIntoView()`,
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
// La liste de courses, descendue à la ligne du gruyère : arrondi au paquet, « à vérifier : paquet peut-être entamé ».
await shoot('telephone-courses-verifier', `${BASE}/m`, PHONE, {
  init: asPhone('alex'),
  after: `[...document.querySelectorAll('.shopping li')].find((l) => l.textContent.includes('Gruyère'))?.scrollIntoView({ block: 'center' })`,
});
// Drive : le produit retenu du gruyère (paquets, secours) ; un lien de fiche partagé, à relier à un article, puis la
// fiche lue ; une fiche que le site refuse (saisie, reprise du stock) ; les réglages (enseigne, magasin).
const productOf = (name: string) =>
  `[...document.querySelectorAll('.shopping li')].find((l) => l.textContent.includes('${name}'))?.querySelector('[aria-label^="Produit chez"]')?.click()`;
const linkTo = (name: string) => `[...document.querySelectorAll('.link-item')].find((b) => b.textContent.includes('${name}'))?.click()`;
const sharedThon = `${BASE}/partager?url=${encodeURIComponent(driveUrl('thon-naturel-exemple'))}`;
await shoot('telephone-drive-produit', `${BASE}/m`, PHONE, { init: asPhone('alex'), after: productOf('Gruyère') });
await shoot('telephone-drive-partage', sharedThon, PHONE, { init: asPhone('alex') });
await shoot('telephone-drive-fiche', sharedThon, PHONE, { init: asPhone('alex'), after: linkTo('Thon'), settle: 2500 });
await shoot('telephone-drive-refus', `${BASE}/partager?url=${encodeURIComponent(DRIVE_REFUSED_URL)}`, PHONE, { init: asPhone('alex'), after: linkTo('Lait'), settle: 2500 });
await shoot('telephone-drive-reglages', `${BASE}/m`, PHONE, {
  init: asPhone('alex'),
  after: `[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Drive'))?.click()`,
});
// Drive, étape 2 : « Remplir le panier » (oignons à compter en pièces, lessive déjà au panier), puis le récapitulatif ;
// sur la tablette, la même liste en grand.
await shoot('telephone-drive-panier', `${BASE}/m`, PHONE, { init: asPhone('alex'), after: click('Remplir le panier') });
// La liste de courses descendue au groupe « Au drive » (la lessive mise au panier, pas encore cochée comme achetée).
await shoot('telephone-drive-marque', `${BASE}/m`, PHONE, {
  init: asPhone('alex'),
  after: `[...document.querySelectorAll('.basket-head')].find((h) => h.textContent.includes('Au drive'))?.scrollIntoView({ block: 'center' })`,
});
await shoot('telephone-drive-recap', `${BASE}/m`, PHONE, { init: asPhone('alex'), after: `${click('Remplir le panier')}; setTimeout(() => { ${click('Récapitulatif')} }, 500)` });
// Drive : le gruyère en rupture (vu par l'extension) dans « Remplir le panier », remplacement proposé (sa fiche
// produit le dit aussi : telephone-drive-produit) ; puis la liste classique où il reste, signalé.
await shoot('telephone-drive-rupture', `${BASE}/m`, PHONE, {
  init: asPhone('alex'),
  after: `${click('Remplir le panier')}; setTimeout(() => { [...document.querySelectorAll('.drive-fill li')].find((li) => li.textContent.includes('Gruyère'))?.scrollIntoView({ block: 'center' }) }, 500)`,
});
await shoot('telephone-drive-rupture-liste', `${BASE}/m`, PHONE, {
  init: asPhone('alex'),
  after: `[...document.querySelectorAll('.product.missing')][0]?.scrollIntoView({ block: 'center' })`,
});
// Drive, étape 3 : l'onglet « Extension » (panier à copier pour l'extension, compte rendu à recoller).
await shoot('telephone-drive-extension', `${BASE}/m`, PHONE, { init: asPhone('alex'), after: `${click('Remplir le panier')}; setTimeout(() => { ${click('Extension')} }, 500)` });
await shoot('telephone-taches', `${BASE}/m/taches`, PHONE, { init: asPhone('lea') });
await shoot('telephone-agenda', `${BASE}/m/agenda`, PHONE, { init: asPhone('lea') });
await shoot('telephone-mots', `${BASE}/m/mots`, PHONE, { init: asPhone('alex') });
// Téléphone d'un parent : la vie scolaire en tête de l'agenda, puis son détail.
await shoot('telephone-agenda-parent', `${BASE}/m/agenda`, PHONE, { init: asPhone('alex') });
await shoot('telephone-vie-scolaire', `${BASE}/m/agenda`, PHONE, { init: asPhone('alex'), after: `document.querySelector('.school-life button')?.click()` });
await shoot('telephone-stock', `${BASE}/m/stock`, PHONE, { init: asPhone('alex') });
// Sans code-barres : la fiche des pommes du marché (quantité à changer, nom et rayon), sur le téléphone d'Alex.
await shoot('telephone-stock-sans-code-barres', `${BASE}/m/stock`, PHONE, {
  init: asPhone('alex'),
  after: `[...document.querySelectorAll('.products li button.name')].find((b) => b.textContent.includes('Pommes'))?.click()`,
});
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

// Caméra en direct : la tablette (onglet de fond, fausse caméra) diffuse vers le téléphone d'Alex, onglet Caméra ;
// capturés pendant la diffusion : le téléphone qui la montre, et le bandeau de la tablette.
const LIVE_SHOTS = ['telephone-camera', 'tablette-camera-direct', 'telephone-camera-parler', 'tablette-camera-parle'];
if (!only || LIVE_SHOTS.some((name) => only.test(name))) {
  await send('Browser.grantPermissions', { origin: BASE, permissions: ['videoCapture', 'audioCapture'] });
  // Les onglets partagent le stockage : sans cela, l'appairage d'un téléphone laissé par les captures précédentes
  // ferait passer la tablette pour un téléphone, qui n'écoute pas les demandes (« Tablette injoignable »).
  const tablet = await openTarget(`${BASE}/`, TABLET, `localStorage.removeItem('homehub.phone');`);
  await sleep(3000);
  const phone = await openTarget(`${BASE}/m/camera`, PHONE, asPhone('alex'));
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const live = await phone.evaluate(`document.querySelector('.camera video')?.readyState >= 2 && !!document.querySelector('.camera .bar')`);
    if (live.result?.value) break;
  }
  await sleep(1500);
  await phone.capture('telephone-camera');
  await tablet.capture('tablette-camera-direct');
  // Alex parle (faux micro de Chrome) : la tablette sonne, puis joue sa voix et affiche « Alex parle ».
  await phone.evaluate(`[...document.querySelectorAll('.camera button')].find((b) => b.textContent.trim() === 'Parler')?.click()`);
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const talking = await tablet.evaluate(`!!document.querySelector('.live.talk') && document.querySelector('audio')?.srcObject?.getAudioTracks().length === 1`);
    if (talking.result?.value) break;
    if (i === 19) console.warn('Voix d’Alex absente sur la tablette');
  }
  await sleep(1000);
  await phone.capture('telephone-camera-parler');
  await tablet.capture('tablette-camera-parle');
  await phone.close();
  await tablet.close();
  await send('Browser.resetPermissions');
}

// Frais à acheter plus tard : deux repas de la semaine prochaine, ajoutés en dernier (les autres captures gardent la
// liste sans eux). Riz sauté lundi 9 : les petits pois attendent vendredi 6 (« Demain ») ; poulet aux courgettes
// mercredi 11 : poulet, courgettes, crème et persil attendent dimanche 8 ; le riz, l'oignon et la carotte (qui se
// gardent) rejoignent la liste tout de suite.
const LATER_SHOTS = ['telephone-courses-plus-tard', 'telephone-menu-plus-tard', 'tablette-menu-plus-tard'];
if (!only || LATER_SHOTS.some((name) => only.test(name))) {
  const poulet = (await call(A, 'POST', '/recipes', {
    content: {
      title: 'Poulet aux courgettes',
      servings: 4,
      ingredients: ['4 blancs de poulet', '3 courgettes', '20 cl de crème fraîche', '1 oignon', '250 g de riz', 'Persil'].map((text) => ({ text })),
      steps: ['Dorer le poulet en morceaux avec l’oignon.', 'Ajouter les courgettes en dés, cuire 15 minutes.', 'Verser la crème, parsemer de persil ; servir avec le riz.'].map((text) => ({ text })),
    },
  })) as { id: string };
  const NEXT = '2026-11-09';
  await call(A, 'POST', '/menu/entries', { week: NEXT, recipeId: recipeId('Riz sauté'), people: 4, day: '2026-11-09' });
  await call(A, 'POST', '/menu/entries', { week: NEXT, recipeId: poulet.id, people: 4, day: '2026-11-11' });
}
const laterHead = `[...document.querySelectorAll('.basket-head')].find((h) => h.textContent.includes('plus tard'))?.scrollIntoView({ block: 'start' })`;
await shoot('telephone-courses-plus-tard', `${BASE}/m`, PHONE, { init: asPhone('alex'), after: laterHead });
const nextWeekLater = `[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Semaine suivante')?.click(); setTimeout(() => document.querySelector('section.later')?.scrollIntoView({ block: 'start' }), 800)`;
await shoot('telephone-menu-plus-tard', `${BASE}/m/menu`, PHONE, { init: asPhone('alex'), after: nextWeekLater });
await shoot('tablette-menu-plus-tard', `${BASE}/menu`, TABLET, { after: nextWeekLater });

// « J'ai cuisiné » : les coquillettes et le thon reliés pour l'occasion (les autres captures les gardent à relier).
// Le mode cuisine des pâtes au thon finit sur le panneau (le repas de mardi est retrouvé seul), « Tout comme proposé »
// choisi ; la fiche du téléphone l'ouvre par « J'ai cuisiné », rien de choisi ; puis le repas noté cuisiné depuis le
// menu (bandeau « Annuler »), et le menu du téléphone. Tout est annulé ensuite : les captures suivantes n'en voient rien.
if (!only || only.test('cuisine-decompte') || only.test('menu-cuisine')) {
  await call(A, 'PUT', `/menu/links/${DOCS_PRODUCTS.pates}`, { link: { key: 'pate', name: 'pâtes', per: { quantity: 500, unit: 'g' } } });
  await call(A, 'PUT', `/menu/links/${DOCS_FOOD.thon}`, { link: { key: 'thon-au-naturel', name: 'thon au naturel', per: { quantity: 140, unit: 'g' } } });
}
const pates = carnet.find((r) => r.title.startsWith('Pâtes au thon'))!;
const finish = `${click('Suivante')}; setTimeout(() => { ${click('Suivante')}; setTimeout(() => { ${click('Terminé')}; setTimeout(() => { ${click('Tout comme proposé')} }, 1200) }, 300) }, 300)`;
await shoot('tablette-cuisine-decompte', `${BASE}/recette/${pates.id}/cuisine`, TABLET, { after: finish, settle: 2500 });
await shoot('telephone-cuisine-decompte', `${BASE}/m/recette/${pates.id}`, PHONE, { init: asPhone('alex'), after: click('J’ai cuisiné'), settle: 2000 });
const cookFromMenu = `${click('Cuisiné ?')}; setTimeout(() => { ${click('Tout comme proposé')}; setTimeout(() => document.querySelector('[role=dialog] footer .btn.primary')?.click(), 400) }, 1500)`;
await shoot('tablette-menu-cuisine', `${BASE}/menu`, TABLET, { after: cookFromMenu, settle: 3500 });
await shoot('telephone-menu-cuisine', `${BASE}/m/menu`, PHONE, { init: asPhone('alex') });
{
  const view = (await call(A, 'GET', `/menu?week=${WEEK}`)) as { entries: { id: string; cooked?: unknown }[] };
  for (const e of view.entries) if (e.cooked) await call(A, 'DELETE', `/menu/entries/${e.id}/cook`);
}
if (!only || only.test('cuisine-decompte') || only.test('menu-cuisine')) {
  await call(A, 'DELETE', `/menu/links/${DOCS_PRODUCTS.pates}`);
  await call(A, 'DELETE', `/menu/links/${DOCS_FOOD.thon}`);
}

// Dates de péremption au menu (ajoutées en dernier, les autres captures du carnet et du menu restent sans elles) : une
// quiche lorraine et un gâteau au yaourt au carnet, la crème, le jambon et les yaourts reliés à leurs ingrédients ;
// « À cuisiner d'abord » les propose. Le gruyère finit samedi 7 (DLC) : les galettes de dimanche portent un avertissement.
// Puis le scanner : un pot de yaourts rangé, déjà daté une fois, porte la pastille « Date ? » ; touchée, le pavé.
const EXPIRY_SHOTS = ['tablette-menu-peremption', 'tablette-scanner-peremption', 'tablette-scanner-date'];
if (!only || EXPIRY_SHOTS.some((name) => only.test(name))) {
  for (const [title, ingredients, steps] of [
    ['Quiche lorraine', ['1 pâte brisée', '200 g de jambon', '3 œufs', '20 cl de crème fraîche', '100 g de gruyère râpé'],
      ['Étaler la pâte dans le moule.', 'Battre les œufs avec la crème, ajouter le jambon et le gruyère.', 'Verser sur la pâte, cuire 35 minutes à 180 °C.']],
    ['Gâteau au yaourt', ['1 pot de yaourt nature', '3 œufs', '2 pots de farine', '1 pot de sucre', '1/2 pot d’huile'],
      ['Mélanger le yaourt, le sucre et les œufs.', 'Ajouter la farine puis l’huile.', 'Cuire 30 minutes à 180 °C.']],
  ] as const) {
    await call(A, 'POST', '/recipes', { content: { title, servings: 4, ingredients: ingredients.map((text) => ({ text })), steps: steps.map((text) => ({ text })) } });
  }
  await call(A, 'PUT', `/menu/links/${DOCS_FRESH.creme}`, { link: { key: 'creme-fraiche', name: 'crème fraîche', per: { quantity: 20, unit: 'cl' } } });
  await call(A, 'PUT', `/menu/links/${DOCS_FRESH.jambon}`, { link: { key: 'jambon', name: 'jambon', per: { quantity: 4, unit: 'piece' } } });
  await call(A, 'PUT', `/menu/links/${DOCS_FRESH.yaourts}`, { link: { key: 'yaourt-nature', name: 'yaourt nature', per: { quantity: 4, unit: 'pot' } } });
  const items = ((await call(A, 'GET', '/stock')) as { items: { product: { code: string }; lots: { id: string }[] }[] }).items;
  const gruyereLot = items.find((i) => i.product.code === DOCS_FOOD.gruyere)!.lots[0];
  await call(A, 'PUT', `/stock/lots/${gruyereLot.id}`, { date: day(2), kind: 'dlc' });
}
await shoot('tablette-menu-peremption', `${BASE}/menu`, TABLET);
await shoot('tablette-scanner-peremption', `${BASE}/scanner`, TABLET, { after: typeCode(DOCS_FRESH.yaourts) });
await shoot('tablette-scanner-date', `${BASE}/scanner`, TABLET, {
  settle: 2500,
  after: `(async () => { ${typeCode(DOCS_FRESH.yaourts)} ${pause} document.querySelector('.date-chip')?.click(); ${pause} ${pause}
    for (const d of '0911') { [...document.querySelectorAll('.keys button')].find((b) => b.textContent.trim() === d)?.click(); ${pause} } })()`,
});

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
