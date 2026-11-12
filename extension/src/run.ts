// Extension « Remplir le panier » : le déroulé d'un remplissage, sans navigateur (logique pure, testée).
// Un remplissage part d'un panier copié depuis HomeHub et avance produit par produit : la fiche du produit est ouverte
// dans l'onglet de la personne, on regarde ce que montre la page (adaptateur de l'enseigne), on décide quoi faire,
// puis on passe au suivant après une pause fixe. Règle d'arrêt : au premier captcha, refus ou page inattendue, on
// s'arrête et on le dit ; on ne réessaie pas, on ne contourne rien, la personne finit à la main (ou reprend elle-même
// plus tard). Seul cas où l'on continue : un produit que la fiche dit indisponible, passé et signalé.
//
// Rythme fixe et lent, sans hasard ni accélération : c'est la cadence d'une personne pressée, pas une imitation.
import { type CartLine, type DriveCart, type DriveReport, REPORT_KIND, type ReportStatus } from '../../shared/drive-cart.ts';
import type { Enseigne } from '../../shared/drive.ts';

/** Pauses du remplissage (ms) : entre deux clics sur une fiche, entre deux produits, attente d'une réponse du site. */
export const PACE = { betweenClicks: 1500, betweenProducts: 4000, confirm: 10_000, settle: 1500 } as const;

export type RunLine = CartLine & {
  status: ReportStatus;
  /** Paquets au panier pour ce produit après le passage. */
  inCart: number;
  ean: string | null;
  price: number | null;
  note: string | null;
};

/** `ready` : panier lu, pas commencé ; `running` : en cours ; `stopped` : arrêté (règle d'arrêt ou la personne) ; `done` : fini. */
export type RunPhase = 'ready' | 'running' | 'stopped' | 'done';

export type Run = {
  version: 1;
  /** Identifiant du remplissage : l'onglet qui l'a reçu est le seul à agir. */
  runId: string;
  enseigne: Enseigne;
  store: string | null;
  phase: RunPhase;
  /** Ligne en cours (ou suivante). */
  index: number;
  lines: RunLine[];
  startedAt: string | null;
  /** Pourquoi le remplissage s'est arrêté (null : pas arrêté). */
  stop: string | null;
  updatedAt: string;
};

/** Ce que montre la page ouverte, lu par l'adaptateur de l'enseigne. */
export type Page =
  | { kind: 'blocked'; reason: string }
  | {
      kind: 'product';
      /** Identifiant du produit de la fiche (JSON-LD, sinon l'adresse). */
      id: string | null;
      ean: string | null;
      price: number | null;
      /** Paquets déjà au panier d'après la fiche (sélecteur de quantité) ; null : on ne sait pas. */
      inCart: number | null;
      canAdd: boolean;
      unavailable: boolean;
    }
  | { kind: 'other'; what: string };

export type Step =
  | { do: 'idle' }
  | { do: 'stop'; reason: string }
  | { do: 'skip'; note: string }
  | { do: 'already'; inCart: number }
  | { do: 'add'; clicks: number; first: boolean; from: number };

export function newRun(cart: DriveCart, runId: string, now: Date): Run {
  return {
    version: 1,
    runId,
    enseigne: cart.enseigne,
    store: cart.store,
    phase: 'ready',
    index: 0,
    lines: cart.lines.map((l) => ({ ...l, status: 'waiting', inCart: 0, ean: null, price: null, note: null })),
    startedAt: null,
    stop: null,
    updatedAt: now.toISOString(),
  };
}

/** Pour un premier essai : seulement les `n` premiers produits d'un remplissage pas encore commencé. */
export const limitRun = (run: Run, n: number): Run => (run.phase === 'ready' && n >= 1 ? { ...run, lines: run.lines.slice(0, n) } : run);

export const current = (run: Run): RunLine | null => run.lines[run.index] ?? null;

/** Commence, ou reprend après un arrêt à la ligne qui a échoué (elle redevient en attente). */
export function startRun(run: Run, now: Date): Run {
  if (run.phase === 'done' || run.phase === 'running' || !current(run)) return run;
  const lines = run.lines.map((l, i) => (i === run.index && l.status === 'failed' ? { ...l, status: 'waiting' as const, note: null } : l));
  return { ...run, lines, phase: 'running', stop: null, startedAt: run.startedAt ?? now.toISOString(), updatedAt: now.toISOString() };
}

/** Décide quoi faire sur la page ouverte pour la ligne en cours. */
export function decide(run: Run, page: Page): Step {
  const line = current(run);
  if (run.phase !== 'running' || !line) return { do: 'idle' };
  if (page.kind === 'blocked') return { do: 'stop', reason: page.reason };
  if (page.kind === 'other') return { do: 'stop', reason: `Page inattendue au lieu de la fiche de « ${line.name} » (${page.what})` };
  if (page.id !== line.id) return { do: 'stop', reason: `Ce n’est pas la fiche attendue (« ${line.name} ») : le site a montré un autre produit` };
  const inCart = page.inCart ?? 0;
  if (inCart >= line.count) return { do: 'already', inCart };
  if (page.unavailable) return { do: 'skip', note: 'Indisponible au magasin choisi' };
  if (!page.canAdd) return { do: 'stop', reason: `Bouton « Ajouter » introuvable sur la fiche de « ${line.name} »` };
  return { do: 'add', clicks: line.count - inCart, first: inCart === 0, from: inCart };
}

/** Ligne en cours terminée (ajoutée, déjà là, passée) : on passe à la suivante, ou c'est fini. */
export function afterLine(run: Run, outcome: Pick<RunLine, 'status' | 'inCart' | 'ean' | 'price' | 'note'>, now: Date): Run {
  const lines = run.lines.map((l, i) => (i === run.index ? { ...l, ...outcome } : l));
  const index = run.index + 1;
  return { ...run, lines, index, phase: index >= lines.length ? 'done' : run.phase, updatedAt: now.toISOString() };
}

/**
 * Arrêt : par la règle d'arrêt sur la ligne en cours (`onLine`, elle est marquée en échec avec ce qu'on a pu lire),
 * ou par la personne (la ligne reste en attente).
 */
export function stopRun(run: Run, reason: string, now: Date, onLine?: Partial<Pick<RunLine, 'inCart' | 'ean' | 'price'>>): Run {
  if (run.phase !== 'running' && run.phase !== 'ready') return run;
  const lines = onLine ? run.lines.map((l, i) => (i === run.index ? { ...l, ...onLine, status: 'failed' as const, note: reason } : l)) : run.lines;
  return { ...run, lines, phase: 'stopped', stop: reason, updatedAt: now.toISOString() };
}

/** Adresse à ouvrir pour la ligne en cours, marquée pour que seul cet onglet agisse. */
export const lineUrl = (run: Run): string | null => {
  const line = current(run);
  return line ? `${line.url}#homehub-panier=${run.runId}` : null;
};

/** Identifiant du remplissage dans l'ancre de l'adresse (« #homehub-panier=… »), ou null. */
export const runIdIn = (hash: string): string | null => /homehub-panier=([\w-]{6,64})/u.exec(hash)?.[1] ?? null;

export function progress(run: Run) {
  const count = (status: ReportStatus) => run.lines.filter((l) => l.status === status).length;
  return { total: run.lines.length, done: run.index, added: count('added'), already: count('already'), skipped: count('skipped'), failed: count('failed'), waiting: count('waiting') };
}

/** Compte rendu à recopier dans HomeHub. */
export function toReport(run: Run, now: Date): DriveReport {
  return {
    kind: REPORT_KIND,
    version: 1,
    enseigne: run.enseigne,
    at: now.toISOString(),
    stop: run.stop,
    lines: run.lines.map(({ itemId, id, name, url, status, inCart, ean, price, note }) => ({ itemId, id, name, url, status, count: inCart, ean, price, note })),
  };
}

/** Résumé d'une ligne pour l'écran (« ✓ 2 ajoutés »). */
export function lineStatus(line: RunLine): string {
  const packs = (n: number) => `${n} paquet${n > 1 ? 's' : ''}`;
  switch (line.status) {
    case 'added':
      return `Ajouté : ${packs(line.inCart)} au panier`;
    case 'already':
      return `Déjà au panier (${packs(line.inCart)})`;
    case 'skipped':
      return line.note ?? 'Passé';
    case 'failed':
      return `Arrêt ici${line.inCart > 0 ? ` (${packs(line.inCart)} au panier)` : ''}`;
    default:
      return `À ajouter : ${packs(line.count)}`;
  }
}
