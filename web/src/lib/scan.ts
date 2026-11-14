// Règles du scanner du stock, sans navigateur : le journal du passage (une ligne par mouvement, annulée, convertie en
// transvasement), le bandeau qui suit une sortie, la saisie du code à la main, le message d'une caméra en panne, et la
// pastille de date d'une entrée (« Date ? », jamais bloquante). Scan.svelte ne garde que la caméra, les appels au
// serveur et l'affichage.
import { normalizeProductCode, validProductCode } from '../../../shared/barcode.ts';
import { asksDate, lotTone, shortDay, shortLotLabel } from '../../../shared/expiry.ts';
import type { Container, LotView, Product, StockMark, StockMovementResult } from '../../../shared/types.ts';
import type { BeepKind } from './beep.ts';
import { cameraError } from './face.ts';
import { productDetail, stockText } from './stock.ts';

export type ScanMode = 'in' | 'out';
export type Facing = 'user' | 'environment';

/** Bandeau du dernier code lu : nom, marque et contenance (`info`), puis ce qui s'est passé (`detail`). */
export type Flash = { tone: BeepKind; title: string; detail: string; info: string };

export type ScanEntry = {
  id: string;
  kind: 'in' | 'out' | 'refill' | 'empty';
  code: string;
  product: Product | null;
  title: string;
  line: string;
  /** Quand et par qui (null : pas encore enregistré). */
  mark: StockMark | null;
  undone: boolean;
  /** Lot où l'entrée est rangée (pour lui donner une date), ou d'où la sortie est partie. */
  lot: LotView | null;
};

/** Question posée à l'écran ; la caméra ne lit plus rien tant qu'elle est ouverte. */
export type ScanDialog =
  | { kind: 'unknown'; code: string; suggestion: { brand?: string | null; quantity?: string | null } | null; baseError: boolean }
  | { kind: 'out-choice'; product: Product; container: Container }
  | { kind: 'forgotten'; product: Product; remaining: number }
  | { kind: 'shop'; code: string; label: string }
  | { kind: 'sheet'; product: Product }
  | { kind: 'pick-container'; entry: ScanEntry; name: string }
  /** « Date ? » touchée : le pavé de date du lot rangé. */
  | { kind: 'date'; entry: ScanEntry }
  /** Plusieurs lots et le premier à sortir est passé : lequel est jeté ? */
  | { kind: 'which'; product: Product; expired: LotView; other: LotView };

/** Taille du journal du passage. */
export const MAX_ENTRIES = 40;

/** Ligne du journal pour un mouvement enregistré. */
export function entryOf(result: StockMovementResult, kind: ScanEntry['kind'], code: string): ScanEntry {
  // Contenant vidé : son nom en titre, ce qu'il contenait en dessous.
  const name = (kind === 'empty' ? result.container?.name : null) ?? result.product?.current.name ?? result.container?.name ?? code;
  const which = result.lot?.date && result.quantity > 0 ? ` · celui du ${shortDay(result.lot.date)}` : '';
  const lines: Record<ScanEntry['kind'], string> = {
    in: `Rangé · ${stockText(result.quantity)}`,
    out: result.forgotten ? `Jeté · entrée oubliée, ${stockText(result.quantity).toLowerCase()}` : `Jeté${which} · ${stockText(result.quantity)}`,
    refill: `Transvasé dans ${result.container?.name ?? 'le contenant'} · emballage jeté`,
    empty: `Contenant vidé${result.product ? ` · c’était ${result.product.current.name}, ${stockText(result.quantity).toLowerCase()}` : ''}`,
  };
  const shopping = result.shopping === 'added' ? ' · ajouté à la liste de courses' : '';
  return {
    id: result.movementId,
    kind,
    code,
    product: result.product,
    title: name,
    line: `${lines[kind]}${shopping}`,
    mark: { at: result.at, by: result.by },
    undone: false,
    lot: result.lot,
  };
}

/** Pastille de date d'une entrée : « Date ? » (produit qui en a l'habitude), sa date, ou « pas de date ». */
export type DateChip = { label: string; tone: 'ask' | 'bad' | 'warn' | 'muted' };

export function entryDateChip(entry: ScanEntry): DateChip | null {
  if (entry.kind !== 'in' || entry.undone || !entry.product || !entry.lot) return null;
  const label = entry.lot.date ? shortLotLabel(entry.lot) : null;
  if (label) return { label, tone: lotTone(entry.lot) };
  return asksDate(entry.product) ? { label: 'Date ?', tone: 'ask' } : { label: 'pas de date', tone: 'muted' };
}

/** Corrections d'une ligne du journal : fiche du produit, « C'était une recharge » (sortie), annuler. Aucune une fois annulée. */
export type EntryAction = 'sheet' | 'refill' | 'undo';

export function entryActions(entry: ScanEntry): EntryAction[] {
  if (entry.undone) return [];
  const actions: EntryAction[] = [];
  if (entry.product) actions.push('sheet');
  if (entry.kind === 'out' && entry.product) actions.push('refill');
  return [...actions, 'undo'];
}

/** Date donnée à un lot (ou partie à une autre date : le lot de l'entrée garde le reste) ; fiche à jour partout. */
export function noteLot(entries: ScanEntry[], entryId: string, lot: LotView, product: Product, split: number | null): ScanEntry[] {
  return entries.map((e) => {
    const withProduct = e.code === product.code ? { ...e, product } : e;
    if (e.id !== entryId) return withProduct;
    return { ...withProduct, lot: split !== null && e.lot ? { ...e.lot, count: e.lot.count - split } : lot };
  });
}

/** Le plus récent en tête, `MAX_ENTRIES` au plus. */
export const addEntry = (entries: ScanEntry[], entry: ScanEntry) => [entry, ...entries].slice(0, MAX_ENTRIES);

/** Mouvement annulé (ou remplacé) : la ligne reste, grisée, avec ce qui s'est passé. */
export const markUndone = (entries: ScanEntry[], id: string, line: string) => entries.map((e) => (e.id === id ? { ...e, undone: true, line } : e));

/** Fiche du produit corrigée : nom à jour sur toutes ses lignes. */
export const renameProduct = (entries: ScanEntry[], product: Product) =>
  entries.map((e) => (e.code === product.code ? { ...e, product, title: product.current.name } : e));

/** Produit épuisé ajouté à la liste de courses après coup : noté sur la dernière ligne. */
export const noteShoppingAdded = (entries: ScanEntry[]) => entries.map((e, i) => (i === 0 ? { ...e, line: `${e.line} · ajouté à la liste de courses` } : e));

/** Sous-titre d'une ligne : marque et contenance (sauf pour un contenant vidé), puis ce qui s'est passé. */
export function entrySubtitle(entry: ScanEntry): string {
  const detail = entry.kind !== 'empty' && entry.product ? productDetail(entry.product.current) : '';
  return `${detail ? `${detail} · ` : ''}${entry.line}`;
}

/** Ligne encore à faire (« C'était une recharge » sur un produit pas encore sorti) : pas d'identifiant de mouvement. */
export function pendingEntry(product: Product): ScanEntry {
  return { id: '', kind: 'out', code: product.code, product, title: product.current.name, line: '', mark: null, undone: false, lot: null };
}

/** Contenant où le produit est d'habitude transvasé, s'il existe encore. */
export const refillContainer = (product: Product, containers: Container[]) => (product.refill ? containers.find((c) => c.id === product.refill) : undefined);

/** Ce qui suit une sortie : proposer la liste de courses (produit épuisé), ou dire où en est le stock. */
export function afterOut(result: StockMovementResult, name: string, info = ''): { flash: Flash; dialog: ScanDialog | null } {
  if (result.shopping === 'propose' && result.product && result.shoppingLabel) {
    return { flash: { tone: 'ask', title: name, detail: 'Épuisé', info }, dialog: { kind: 'shop', code: result.product.code, label: result.shoppingLabel } };
  }
  const which = result.lot?.date && result.quantity > 0 && !result.container ? ` · sorti : celui du ${shortDay(result.lot.date)}` : '';
  const detail = result.container && !result.product ? 'Contenant vide' : result.container ? `Dans ${result.container.name}` : `${stockText(result.quantity)}${which}`;
  return { flash: { tone: 'ok', title: name, detail: result.shopping === 'added' ? `${detail} · ajouté à la liste de courses` : detail, info }, dialog: null };
}

/** Code tapé à la main : chiffres seuls, clé vérifiée, puis mis sous sa forme habituelle. */
export function readManualCode(input: string): { code: string } | { error: string } {
  const digits = input.replace(/\D/gu, '');
  if (!validProductCode(digits)) return { error: 'Code invalide : 8, 12 ou 13 chiffres, avec la clé' };
  return { code: normalizeProductCode(digits) };
}

/** Message d'une caméra qui ne s'ouvre pas ; sur le téléphone, la saisie à la main reste possible. */
export function cameraProblem(err: unknown, phone: boolean): string {
  const name = (err as Error)?.name;
  if (name === 'NotReadableError') return 'Caméra occupée : réessaie dans un instant';
  if (phone && name === 'NotAllowedError') return 'Caméra refusée : autorise-la dans le navigateur, ou saisis le code à la main';
  return cameraError(err);
}
