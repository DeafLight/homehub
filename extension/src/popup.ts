// Extension « Remplir le panier » : le panneau du bouton de l'extension. On y colle le panier copié depuis HomeHub
// (mode « Remplir le panier », bouton « Copier pour l'extension »), on lance le remplissage dans l'onglet ouvert sur
// le site de l'enseigne (connecté au compte de la personne), on suit, on arrête, et à la fin on copie le compte rendu
// à recoller dans HomeHub. Le panneau ne lance rien tout seul : chaque remplissage part d'un clic de la personne.
import { formatPrice, parseCart } from '../../shared/drive-cart.ts';
import { enseigneOf } from '../../shared/drive.ts';
import { limitRun, lineStatus, lineUrl, newRun, progress, type Run, startRun, stopRun, toReport } from './run.ts';
import { clearRun, loadRun, onRunChange, saveRun } from './storage.ts';

const SITE = { origins: ['https://www.coursesu.com/*', 'https://coursesu.com/*'] };
const app = document.getElementById('app')!;
let message: { text: string; kind: 'warn' | 'error' | 'muted' } | null = null;

/** Petit constructeur d'éléments. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: (Node | string | null)[]) {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  Object.assign(el, rest);
  if (cls) el.className = cls;
  el.append(...children.filter((c): c is Node | string => c !== null));
  return el;
}

const say = (text: string, kind: 'warn' | 'error' | 'muted' = 'warn') => {
  message = { text, kind };
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/** Lance (ou reprend) le remplissage dans l'onglet ouvert, s'il est sur le site de l'enseigne. */
async function start(run: Run) {
  // Demandé tout de suite, pendant le clic (Firefox ne demande les droits que dans le geste de la personne).
  if (!(await chrome.permissions.request({ origins: SITE.origins }))) {
    say('Sans l’accès au site Courses U, l’extension ne peut rien ajouter.');
    return render(run);
  }
  const tab = await activeTab();
  if (!tab?.id || !tab.url || enseigneOf(tab.url) !== run.enseigne) {
    say('Ouvre d’abord www.coursesu.com dans cet onglet, connecte-toi à ton compte et choisis ton magasin, puis reviens ici.');
    return render(run);
  }
  const started = startRun(run, new Date());
  await saveRun(started);
  await chrome.tabs.update(tab.id, { url: lineUrl(started)! });
  window.close();
}

async function copy(text: string, area: HTMLTextAreaElement) {
  try {
    await navigator.clipboard.writeText(text);
    say('Compte rendu copié : colle-le dans HomeHub (Remplir le panier → Extension).', 'muted');
  } catch {
    area.select();
    say('Copie refusée par le navigateur : sélectionne le texte et copie-le à la main.');
  }
  render(await loadRun());
}

function pasteView() {
  const area = h('textarea', { placeholder: 'Colle ici le panier copié depuis HomeHub (Remplir le panier → Extension → Copier pour l’extension)' });
  const read = h('button', { class: 'primary', textContent: 'Lire le panier' });
  read.onclick = async () => {
    const parsed = parseCart(area.value);
    if (!parsed.ok) {
      say(parsed.error, 'error');
      return render(await loadRun());
    }
    message = null;
    await saveRun(newRun(parsed.value, crypto.randomUUID(), new Date()));
  };
  return [h('p', {}, 'Dans HomeHub, ouvre « Remplir le panier », onglet « Extension », et copie le panier.'), area, h('div', { class: 'actions' }, read)];
}

function linesList(run: Run) {
  return h('ul', {}, ...run.lines.map((l) => h('li', { class: l.status }, h('span', {}, `${l.label ? `${l.label} · ` : ''}${l.name}`), h('span', { class: 'state' }, `${lineStatus(l)}${l.price !== null ? ` · ${formatPrice(l.price)} le paquet` : ''}${l.note && l.status === 'failed' ? ` · ${l.note}` : ''}`))));
}

function readyView(run: Run) {
  const packs = run.lines.reduce((sum, l) => sum + l.count, 0);
  const go = h('button', { class: 'primary', textContent: 'Remplir le panier' });
  // Pour un premier essai : seulement les premiers produits (le reste n'est pas gardé).
  const sizes = [...new Set([1, 3, run.lines.length])].filter((n) => n <= run.lines.length);
  const limit = h('select', { ariaLabel: 'Produits à ajouter' }, ...sizes.map((n) => h('option', { value: String(n), selected: n === run.lines.length, textContent: n === run.lines.length ? 'Tous les produits' : `Essai : ${n === 1 ? 'le premier produit' : `les ${n} premiers`}` })));
  go.onclick = () => void start(limitRun(run, Number(limit.value)));
  const forget = h('button', { textContent: 'Autre panier' });
  forget.onclick = () => void clearRun();
  return [
    h('h2', {}, `${run.lines.length} produit${run.lines.length > 1 ? 's' : ''}, ${packs} paquet${packs > 1 ? 's' : ''}${run.store ? ` · ${run.store}` : ''}`),
    linesList(run),
    sizes.length > 1 ? h('p', {}, limit) : null,
    h('p', { class: 'muted' }, 'Une fiche après l’autre, au rythme d’une personne (quelques secondes par produit). Arrêt au premier captcha, refus ou page inattendue : tu finis à la main. Rien n’est payé, aucun créneau n’est réservé.'),
    h('div', { class: 'actions' }, go, forget),
  ];
}

function runningView(run: Run) {
  const p = progress(run);
  const halt = h('button', { textContent: 'Arrêter' });
  halt.onclick = async () => void saveRun(stopRun((await loadRun()) ?? run, 'Arrêté par toi', new Date()));
  return [h('h2', {}, `En cours · ${Math.min(p.done + 1, p.total)} sur ${p.total}`), linesList(run), h('div', { class: 'actions' }, halt)];
}

function endView(run: Run) {
  const p = progress(run);
  const report = JSON.stringify(toReport(run, new Date()));
  const area = h('textarea', { readOnly: true, value: report });
  const copyButton = h('button', { class: 'primary', textContent: 'Copier le compte rendu' });
  copyButton.onclick = () => void copy(report, area);
  const resume = run.phase === 'stopped' ? h('button', { textContent: 'Reprendre' }) : null;
  if (resume) resume.onclick = () => void start(run);
  const again = h('button', { textContent: 'Nouveau panier' });
  again.onclick = () => void clearRun();
  return [
    h('h2', {}, run.phase === 'done' ? 'Terminé' : 'Arrêté'),
    run.stop ? h('p', { class: 'warn' }, run.stop) : null,
    h('p', {}, `${p.added + p.already} au panier${p.skipped ? `, ${p.skipped} introuvable${p.skipped > 1 ? 's' : ''} ou en rupture` : ''}${p.waiting + p.failed ? `, ${p.waiting + p.failed} à finir à la main` : ''}. Vérifie ton panier sur le site avant de commander.`),
    linesList(run),
    h('p', { class: 'muted' }, 'Pour marquer les lignes « au drive » dans HomeHub : copie ce compte rendu, puis colle-le dans Remplir le panier → Extension. Les produits introuvables ou en rupture y sont signalés, avec un remplacement à choisir.'),
    area,
    h('div', { class: 'actions' }, copyButton, resume, again),
  ];
}

function render(run: Run | null) {
  const body = !run ? pasteView() : run.phase === 'ready' ? readyView(run) : run.phase === 'running' ? runningView(run) : endView(run);
  app.replaceChildren(...(message ? [h('p', { class: message.kind }, message.text)] : []), ...body.filter((n) => n !== null));
}

onRunChange(render);
void loadRun().then(render);
