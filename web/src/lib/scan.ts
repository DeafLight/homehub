// Règles du scanner du stock, sans navigateur : le journal du passage (une ligne par mouvement, annulée, convertie en
// transvasement), le bandeau qui suit une sortie, la saisie du code à la main et le message d'une caméra en panne.
// Scan.svelte ne garde que la caméra, les appels au serveur et l'affichage.
import { normalizeProductCode, validProductCode } from '../../../shared/barcode.ts';
import type { Container, Product, StockMark, StockMovementResult } from '../../../shared/types.ts';
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
};

/** Question posée à l'écran ; la caméra ne lit plus rien tant qu'elle est ouverte. */
export type ScanDialog =
  | { kind: 'unknown'; code: string; suggestion: { brand?: string | null; quantity?: string | null } | null; baseError: boolean }
  | { kind: 'out-choice'; product: Product; container: Container }
  | { kind: 'forgotten'; product: Product; remaining: number }
  | { kind: 'shop'; code: string; label: string }
  | { kind: 'sheet'; product: Product }
  | { kind: 'pick-container'; entry: ScanEntry; name: string };

/** Taille du journal du passage. */
export const MAX_ENTRIES = 40;

/** Ligne du journal pour un mouvement enregistré. */
export function entryOf(result: StockMovementResult, kind: ScanEntry['kind'], code: string): ScanEntry {
  // Contenant vidé : son nom en titre, ce qu'il contenait en dessous.
  const name = (kind === 'empty' ? result.container?.name : null) ?? result.product?.current.name ?? result.container?.name ?? code;
  const lines: Record<ScanEntry['kind'], string> = {
    in: `Rangé · ${stockText(result.quantity)}`,
    out: result.forgotten ? `Jeté · entrée oubliée, ${stockText(result.quantity).toLowerCase()}` : `Jeté · ${stockText(result.quantity)}`,
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
  };
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
  return { id: '', kind: 'out', code: product.code, product, title: product.current.name, line: '', mark: null, undone: false };
}

/** Contenant où le produit est d'habitude transvasé, s'il existe encore. */
export const refillContainer = (product: Product, containers: Container[]) => (product.refill ? containers.find((c) => c.id === product.refill) : undefined);

/** Ce qui suit une sortie : proposer la liste de courses (produit épuisé), ou dire où en est le stock. */
export function afterOut(result: StockMovementResult, name: string, info = ''): { flash: Flash; dialog: ScanDialog | null } {
  if (result.shopping === 'propose' && result.product && result.shoppingLabel) {
    return { flash: { tone: 'ask', title: name, detail: 'Épuisé', info }, dialog: { kind: 'shop', code: result.product.code, label: result.shoppingLabel } };
  }
  const detail = result.container && !result.product ? 'Contenant vide' : result.container ? `Dans ${result.container.name}` : stockText(result.quantity);
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
