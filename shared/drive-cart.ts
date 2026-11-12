// Drive, étape 3 : ce qui passe entre HomeHub et l'extension « Remplir le panier », par copier-coller (petit JSON).
// Dans un sens, le panier préparé (DriveCart) : pour chaque article qui reste à mettre au panier, l'identifiant du
// produit retenu chez l'enseigne, le lien de sa fiche et le nombre de paquets. Dans l'autre, le compte rendu
// (DriveReport) : ce qui est parti au panier, avec l'EAN et le prix lus dans la page s'ils y étaient.
// Partagé entre le front (qui copie le panier), l'extension (qui le lit et écrit le compte rendu) et le serveur (qui
// relit le compte rendu, avec son propre schéma). Rien de personnel : des produits d'un catalogue public, les noms des
// articles de la liste, aucun compte ni jeton de l'enseigne.
//
// L'extension ne suit que des liens de fiches produit de l'enseigne : un panier dont un lien sort du site, ou dont
// l'identifiant ne correspond pas à son lien, est refusé en entier (on ne navigue jamais vers une adresse inconnue).
import { type DriveView, type Enseigne, ENSEIGNES, type FillRow, itemName, productLink } from './drive.ts';
import type { ShoppingItem } from './types.ts';

export const CART_KIND = 'homehub-drive-cart';
export const REPORT_KIND = 'homehub-drive-report';
export const CART_LIMITS = { lines: 150, count: 50, name: 120 } as const;

/** Un produit à mettre au panier. */
export type CartLine = {
  /** Article de la liste de courses (son identifiant), à marquer « au drive » au retour. */
  itemId: string;
  /** Nom de l'article (« Gruyère »), pour s'y retrouver. */
  label: string;
  /** Identifiant du produit chez l'enseigne, son nom et le lien de sa fiche. */
  id: string;
  name: string;
  url: string;
  /** Paquets à mettre au panier. */
  count: number;
};

export type DriveCart = { kind: typeof CART_KIND; version: 1; enseigne: Enseigne; store: string | null; lines: CartLine[] };

/**
 * Ce qu'est devenue une ligne : `added` (ajoutée par l'extension), `already` (déjà au panier en quantité suffisante),
 * `skipped` (indisponible, passée), `failed` (l'arrêt s'est produit sur elle), `waiting` (pas atteinte).
 */
export type ReportStatus = 'added' | 'already' | 'skipped' | 'failed' | 'waiting';

export type ReportLine = Pick<CartLine, 'itemId' | 'id' | 'name' | 'url'> & {
  status: ReportStatus;
  /** Paquets au panier pour ce produit après le passage (0 si rien). */
  count: number;
  /** EAN et prix d'un paquet lus dans la page, s'ils y étaient. */
  ean: string | null;
  price: number | null;
  note: string | null;
};

export type DriveReport = { kind: typeof REPORT_KIND; version: 1; enseigne: Enseigne; at: string; stop: string | null; lines: ReportLine[] };

/**
 * POST /api/drive/report : articles marqués « au drive », prix notés, articles signalés introuvables ou en rupture
 * (lignes passées par l'extension), lignes laissées de côté et pourquoi.
 */
export type DriveReportResult = { view: DriveView; marked: number; prices: number; missing: number; ignored: { name: string; reason: string }[] };

/**
 * Panier à copier pour l'extension : les articles qui ont un produit à mettre au panier (le retenu, ou son
 * remplacement s'il est introuvable ou en rupture) et n'y sont pas encore. Un article à remplacer n'y est pas.
 */
export function cartFor<I extends ShoppingItem>(rows: readonly FillRow<I>[], enseigne: Enseigne, store: string | null): DriveCart {
  const lines = rows
    .filter((r) => r.line === null && r.status === 'ready' && r.product && r.count)
    .slice(0, CART_LIMITS.lines)
    .map((r) => {
      const product = r.product!;
      return { itemId: r.item.id, label: itemName(r.item), id: product.id, name: product.name, url: product.url, count: Math.min(r.count!.count, CART_LIMITS.count) };
    });
  return { kind: CART_KIND, version: 1, enseigne, store, lines };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const shortText = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

/** JSON collé (l'objet, ou du texte autour : on garde de la première accolade à la dernière). */
function parseJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Lit un panier collé dans l'extension ; refusé en entier au moindre lien qui n'est pas une fiche de l'enseigne. */
export function parseCart(text: string): Parsed<DriveCart> {
  const data = parseJson(text);
  if (!isObject(data) || data.kind !== CART_KIND) return { ok: false, error: 'Ce n’est pas un panier copié depuis HomeHub (bouton « Copier pour l’extension »)' };
  if (data.version !== 1) return { ok: false, error: 'Panier d’une autre version de HomeHub : mets l’extension à jour' };
  const enseigne = ENSEIGNES.find((e) => e === data.enseigne);
  if (!enseigne) return { ok: false, error: 'Enseigne inconnue de l’extension' };
  if (!Array.isArray(data.lines) || data.lines.length === 0) return { ok: false, error: 'Panier vide : rien à ajouter' };
  if (data.lines.length > CART_LIMITS.lines) return { ok: false, error: `Panier trop grand (${CART_LIMITS.lines} produits au plus)` };
  const lines: CartLine[] = [];
  for (const [i, raw] of data.lines.entries()) {
    const line = isObject(raw) ? raw : {};
    const url = shortText(line.url, 2000);
    const link = url ? productLink(url) : null;
    const id = shortText(line.id, 80);
    const count = line.count;
    if (!link || link.enseigne !== enseigne || link.id !== id) return { ok: false, error: `Ligne ${i + 1} : lien qui n’est pas une fiche produit de l’enseigne` };
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > CART_LIMITS.count) return { ok: false, error: `Ligne ${i + 1} : nombre de paquets illisible` };
    const itemId = shortText(line.itemId, 80);
    if (!itemId) return { ok: false, error: `Ligne ${i + 1} : article manquant` };
    lines.push({ itemId, label: shortText(line.label, CART_LIMITS.name) ?? '', id: link.id, name: shortText(line.name, CART_LIMITS.name) ?? link.id, url: link.url, count });
  }
  const store = shortText(data.store, 80);
  return { ok: true, value: { kind: CART_KIND, version: 1, enseigne, store, lines } };
}

/**
 * Compte rendu collé dans HomeHub : seulement reconnu ici (format, version), le serveur le vérifie en entier.
 */
export function readReport(text: string): Parsed<Json> {
  const data = parseJson(text);
  if (!isObject(data) || data.kind !== REPORT_KIND) return { ok: false, error: 'Ce n’est pas un compte rendu de l’extension (bouton « Copier le compte rendu » de son panneau)' };
  if (data.version !== 1) return { ok: false, error: 'Compte rendu d’une autre version de l’extension : mets-la à jour' };
  return { ok: true, value: data };
}

/** Ce qu'a donné un compte rendu, en une phrase (« 2 articles marqués au drive, 1 prix noté »). */
export function reportSummary(result: Pick<DriveReportResult, 'marked' | 'prices' | 'ignored'> & { missing?: number }): string {
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
  const parts = [result.marked ? `${plural(result.marked, 'article')} marqué${result.marked > 1 ? 's' : ''} « au drive »` : 'Aucun article marqué « au drive »'];
  if (result.prices) parts.push(`${plural(result.prices, 'prix')} noté${result.prices > 1 ? 's' : ''}`.replace('prixs', 'prix'));
  if (result.missing) parts.push(`${plural(result.missing, 'article')} introuvable${result.missing > 1 ? 's' : ''} ou en rupture, à remplacer`);
  const ignored = result.ignored.length ? ` ; laissé${result.ignored.length > 1 ? 's' : ''} de côté : ${result.ignored.map((i) => `${i.name} (${i.reason})`).join(', ')}` : '';
  return `${parts.join(', ')}${ignored}.`;
}

/** Prix affiché (« 2,35 € », « 2.35 », « 12 345,60 € ») → nombre, ou null s'il est illisible. */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 && raw < 10_000 ? Math.round(raw * 100) / 100 : null;
  if (typeof raw !== 'string') return null;
  // « 2€35 » (euro entre les euros et les centimes, courant sur les sites de drive).
  const split = /(\d+)\s*€\s*(\d{2})\b/u.exec(raw);
  if (split) return parsePrice(Number(`${split[1]}.${split[2]}`));
  const m =/(\d{1,3}(?:[   ]\d{3})*|\d+)(?:[.,](\d{1,2}))?/u.exec(raw);
  if (!m) return null;
  const value = Number(`${m[1].replace(/[   ]/gu, '')}.${m[2] ?? '0'}`);
  return parsePrice(value);
}

/** Prix en euros (« 2,35 € »). */
export const formatPrice = (value: number) => `${value.toFixed(2).replace('.', ',')} €`;
