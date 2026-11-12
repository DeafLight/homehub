// Drive côté écran : ce qu'une ligne de la liste de courses dit de son produit chez l'enseigne, l'aperçu des paquets
// pendant qu'on choisit, le message de correspondance avec le stock, le lien d'une fiche reçu par « Partager », et la
// marque « au drive » d'un article mis au panier en cours, et celle d'un article introuvable ou en rupture.
import {
  basketLines,
  choiceFor,
  type DriveChoice,
  type DriveProduct,
  drivePacks,
  type DriveView,
  eanCheck,
  type DriveStockHint,
  formatCount,
  itemKey,
  missingOf,
  missingState,
  productLink,
} from '../../../shared/drive.ts';
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

/** Paquets pendant qu'on choisit : « 2 × 200 g pour 350 g » (`pieces` : pièces par paquet, si on les a dites). */
export function packsPreview(item: Pick<ShoppingItem, 'menu'>, packText: string | null, pieces: number | null = null): string | null {
  const packs = drivePacks(item, { pack: parsePackage(packText), pieces });
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

/** Quantité d'une ligne telle qu'écrite après le nom (« Lardons · 350 g » → « 350 g »), ou null. */
export const itemAmount = (item: Pick<ShoppingItem, 'label'>) => item.label.split(' · ')[1]?.trim() || null;

/** Ligne du panier en cours pour un article (« Au drive : Gruyère râpé, 200g · 2 × 200 g »), ou null. */
export function basketMark(view: DriveView, item: Pick<ShoppingItem, 'id'>): string | null {
  const line = basketLines(view).find((l) => l.itemId === item.id);
  return line ? `Au drive${line.product ? ` : ${line.product.name}` : ''} · ${formatCount(line)}` : null;
}

/**
 * Article introuvable ou en rupture dans le panier en cours, tel que la liste classique le montre : « Introuvable ou
 * en rupture : Gruyère râpé, 200g · à remplacer », ou « Remplacé par Gruyère râpé, 500g (…en rupture) » ; null sinon.
 */
export function missingMark(view: DriveView, item: Pick<ShoppingItem, 'id' | 'label' | 'menu'>): string | null {
  const enseigne = view.settings.enseigne;
  if (!enseigne) return null;
  const choice = choiceFor(view.choices, itemKey(item), enseigne);
  const state = missingState(choice, missingOf(view, item.id));
  if (!state.active || !choice?.preferred) return null;
  return state.replacement
    ? `Remplacé par ${state.replacement.name} (${choice.preferred.name} en rupture)`
    : `Introuvable ou en rupture : ${choice.preferred.name} · à remplacer`;
}
