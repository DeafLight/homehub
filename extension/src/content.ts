// Extension « Remplir le panier » : script chargé dans les pages du site de l'enseigne (Courses U), dans l'onglet de
// la personne, connectée à son compte. Il ne fait rien tant qu'aucun remplissage n'est lancé depuis le panneau de
// l'extension. Pendant un remplissage : un bandeau en bas de page dit où on en est (et permet d'arrêter) ; sur la
// fiche attendue, on lit la page, on clique « Ajouter » et « + » comme la personne, puis on ouvre la fiche suivante
// après une pause fixe. Seul l'onglet qui a reçu le remplissage agit (marque dans l'adresse, retenue pour l'onglet).
// Au premier captcha, refus ou page inattendue : arrêt, dit dans le bandeau ; la personne finit à la main.
import { formatPrice } from '../../shared/drive-cart.ts';
import { addToCart, inspect } from './coursesu.ts';
import { afterLine, current, decide, lineStatus, lineUrl, PACE, progress, type Run, runIdIn, stopRun } from './run.ts';
import { loadRun, onRunChange, saveRun } from './storage.ts';

const CLAIM = 'homehub-panier';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let busy = false;

// --- Bandeau (dans une racine fantôme, pour ne pas toucher aux styles du site).
const host = document.createElement('div');
host.id = 'homehub-remplir-le-panier';
const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = `<style>
  :host { --bg: #0f1115; --surface: #1a1d24; --fg: #f2f4f8; --fg-muted: #a3aab8; --rain: #5b8def; --ok: #4caf7a; --sun: #f2b84b;
    --danger: #e5484d; all: initial; }
  .bar { position: fixed; z-index: 2147483647; left: 16px; right: 16px; bottom: 16px; max-width: 560px; margin: 0 auto;
    display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-radius: 14px; background: var(--surface);
    color: var(--fg); font: 15px/1.35 system-ui, sans-serif; box-shadow: 0 6px 24px rgb(0 0 0 / 0.45); border: 1px solid var(--rain); }
  .bar.stopped { border-color: var(--sun); } .bar.done { border-color: var(--ok); }
  .text { flex: 1; min-width: 0; } .title { font-weight: 700; } .muted { color: var(--fg-muted); font-size: 13px; }
  button { flex-shrink: 0; padding: 8px 14px; border: 0; border-radius: 10px; background: var(--bg); color: var(--fg);
    font: inherit; font-weight: 600; cursor: pointer; }
</style><div class="bar" hidden><div class="text"><div class="title"></div><div class="muted"></div></div><button type="button"></button></div>`;
const bar = shadow.querySelector<HTMLDivElement>('.bar')!;
const title = shadow.querySelector<HTMLDivElement>('.title')!;
const detail = shadow.querySelector<HTMLDivElement>('.muted')!;
const button = shadow.querySelector<HTMLButtonElement>('button')!;
let buttonAction: () => void = () => {};
button.addEventListener('click', () => buttonAction());

const mine = (run: Run) => sessionStorage.getItem(CLAIM) === run.runId;

function render(run: Run | null) {
  if (!run || !mine(run) || run.phase === 'ready') {
    bar.hidden = true;
    return;
  }
  if (!host.isConnected) document.documentElement.append(host);
  bar.hidden = false;
  bar.className = `bar ${run.phase}`;
  const p = progress(run);
  const line = current(run);
  if (run.phase === 'running') {
    title.textContent = `HomeHub remplit le panier · ${Math.min(p.done + 1, p.total)} sur ${p.total}`;
    detail.textContent = line ? `${line.name} · ${lineStatus(line)}` : '';
    button.textContent = 'Arrêter';
    buttonAction = () => void stop('Arrêté par toi');
  } else {
    const parts = [`${p.added + p.already} au panier`, p.skipped ? `${p.skipped} indisponible${p.skipped > 1 ? 's' : ''}` : '', p.waiting + p.failed ? `${p.waiting + p.failed} à finir à la main` : ''].filter(Boolean);
    title.textContent = run.phase === 'done' ? `Panier rempli : ${parts.join(', ')}` : `Arrêté : ${run.stop ?? ''}`;
    const priced = run.lines.filter((l) => l.price !== null && l.inCart > 0);
    const total = priced.reduce((sum, l) => sum + l.price! * l.inCart, 0);
    detail.textContent = `${run.phase === 'stopped' ? `${parts.join(', ')}. ` : ''}Vérifie ton panier sur le site ; copie le compte rendu depuis le bouton de l’extension pour HomeHub.${priced.length ? ` Prix vus : ${formatPrice(total)}.` : ''}`;
    button.textContent = 'Fermer';
    buttonAction = () => {
      bar.hidden = true;
      sessionStorage.removeItem(CLAIM);
    };
  }
}

async function stop(reason: string, onLine?: Parameters<typeof stopRun>[3]) {
  const run = await loadRun();
  if (run) await saveRun(stopRun(run, reason, new Date(), onLine));
}

const notRunning = async (runId: string) => {
  const run = await loadRun();
  return run?.runId !== runId || run.phase !== 'running';
};

/** Ouvre la fiche suivante après la pause, si le remplissage continue. */
async function next(run: Run) {
  render(run);
  const url = lineUrl(run);
  if (run.phase !== 'running' || !url) return;
  await sleep(PACE.betweenProducts);
  if (await notRunning(run.runId)) return;
  location.assign(url);
}

/** Un pas du remplissage sur la page ouverte. */
async function tick() {
  if (busy) return;
  busy = true;
  try {
    let run = await loadRun();
    if (run && runIdIn(location.hash) === run.runId) {
      sessionStorage.setItem(CLAIM, run.runId);
      history.replaceState(history.state, '', location.pathname + location.search);
    }
    render(run);
    if (!run || run.phase !== 'running' || !mine(run)) return;
    await sleep(PACE.settle);
    const page = inspect(document, location);
    const step = decide(run, page);
    const seen = page.kind === 'product' ? { ean: page.ean, price: page.price } : { ean: null, price: null };
    const now = () => new Date();
    if (step.do === 'idle') return;
    if (step.do === 'stop') {
      await saveRun((run = stopRun(run, step.reason, now(), { ...seen, inCart: page.kind === 'product' ? (page.inCart ?? 0) : 0 })));
      return render(run);
    }
    if (step.do === 'skip') return next(await save(afterLine(run, { status: 'skipped', inCart: 0, note: step.note, ...seen }, now())));
    if (step.do === 'already') return next(await save(afterLine(run, { status: 'already', inCart: step.inCart, note: null, ...seen }, now())));
    const result = await addToCart(step.clicks, step.first, step.from, {
      pace: PACE,
      doc: document,
      loc: location,
      sleep,
      stopped: () => notRunning(run!.runId),
    });
    run = (await loadRun()) ?? run;
    if (!result.ok) {
      if (run.phase === 'running') await saveRun((run = stopRun(run, result.reason, now(), { ...seen, inCart: result.inCart })));
      return render(run);
    }
    return next(await save(afterLine(run, { status: 'added', inCart: result.inCart, note: null, ...seen }, now())));
  } finally {
    busy = false;
  }
}

async function save(run: Run) {
  await saveRun(run);
  return run;
}

onRunChange((run) => {
  render(run);
  if (run?.phase === 'running') void tick();
});
addEventListener('hashchange', () => void tick());
void tick();
