// Drive côté écran : ce qu'une ligne de la liste de courses dit de son produit chez l'enseigne, l'aperçu des paquets
// pendant qu'on choisit, le message de correspondance avec le stock, et le lien d'une fiche reçu par « Partager ».
import { type DriveChoice, type DriveProduct, drivePacks, eanCheck, type DriveStockHint, productLink } from '../../../shared/drive.ts';
import { formatPacks } from '../../../shared/menu.ts';
import { formatQuantities, parsePackage } from '../../../shared/quantities.ts';
import type { ShoppingItem } from '../../../shared/types.ts';

/** Ligne de la liste sous l'article : « Lardons fumés, 2x100g · 2 × 200 g » ; null sans choix. */
export function choiceSummary(item: Pick<ShoppingItem, 'menu'>, choice: DriveChoice | null): string | null {
  if (!choice) return null;
  if (!choice.preferred) return `Produit à choisir (${choice.fallback.length > 1 ? `${choice.fallback.length} secours` : '1 secours'})`;
  const packs = drivePacks(item, choice.preferred);
  return packs ? `${choice.preferred.name} · ${formatPacks(packs)}` : choice.preferred.name;
}

/** Paquets pendant qu'on choisit : « 2 × 200 g pour 350 g » ; null si rien à calculer. */
export function packsPreview(item: Pick<ShoppingItem, 'menu'>, packText: string | null): string | null {
  const packs = drivePacks(item, { pack: parsePackage(packText) });
  if (!packs || !item.menu) return null;
  return `${formatPacks(packs)} pour ${formatQuantities(item.menu.quantities)}`;
}

/** Contenance d'un produit retenu, ou ce qui manque. */
export const packLabel = (product: Pick<DriveProduct, 'packText' | 'pack'>) =>
  product.pack ? product.packText : product.packText ? `${product.packText} (illisible)` : 'Contenance inconnue';

/** Ce que dit l'EAN du produit comparé au stock : même produit, autre produit, ou rien. */
export function eanMessage(ean: string | null, hints: readonly DriveStockHint[]): { ok: boolean; text: string } | null {
  const check = eanCheck(ean, hints);
  if (check === 'match') return { ok: true, text: 'Même code-barres qu’un produit du stock' };
  if (check === 'other') return { ok: false, text: 'Autre code-barres que les produits du stock pour cet article' };
  return null;
}

/** Lien d'une fiche produit d'une enseigne reçu par « Partager » (champ url, texte ou titre), sinon null. */
export function sharedProductLink(params: URLSearchParams): string | null {
  for (const key of ['url', 'text', 'title']) {
    const link = productLink(params.get(key) ?? '');
    if (link) return link.url;
  }
  return null;
}
