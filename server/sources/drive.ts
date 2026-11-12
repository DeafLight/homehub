// Drive (drive.json dans le dossier d'état) : l'enseigne et le magasin de retrait choisis, et pour chaque article de
// la liste de courses (par clé) le produit retenu chez cette enseigne, avec ses produits de secours. Rien de
// personnel : seulement des produits d'un catalogue public et le nom d'un magasin. Les choix sont gardés par enseigne :
// changer d'enseigne ne perd pas ceux de la précédente.
//
// Étape 2 : le nombre de pièces d'un paquet, retenu sur le produit (`pieces`), et le panier en cours (un seul) : les
// articles de la liste mis au panier de l'enseigne, par identifiant d'article. Une ligne dont l'article a quitté la
// liste (retiré, ou vidé du panier une fois acheté) disparaît à l'écriture suivante ; « Nouveau panier » les retire
// toutes. Les fichiers de l'étape 1 se lisent tels quels (pas de pièces, pas de panier).
//
// Étape 3 : le dernier prix d'un paquet vu par l'extension « Remplir le panier » (`price`, indicatif), et l'EAN lu sur
// la fiche quand le produit n'en avait pas. Les fichiers des étapes 1 et 2 se lisent tels quels (pas de prix).
//
// Introuvable ou en rupture : les articles signalés pendant le panier en cours (`missing` du panier, nettoyés comme
// ses lignes) et le remplacement choisi pour ce panier ; la trace sur le produit (`missingAt`), effacée quand il
// repart au panier. Les fichiers plus anciens se lisent tels quels (aucun signalement, aucune trace).
import { z } from 'zod';
import {
  DRIVE_LIMITS,
  type DriveBasket,
  type DriveBasketLine,
  type DriveChoice,
  type DriveMissing,
  type DriveProduct,
  type DriveSettings,
  ENSEIGNES,
  type Enseigne,
} from '../../shared/drive.ts';
import { UNITS } from '../../shared/ingredients.ts';
import type { Author } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema, sameShape } from './schemas.ts';
import type { Clock } from './types.ts';

const productSchema = z.object({
  enseigne: z.enum(ENSEIGNES),
  id: z.string(),
  url: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  packText: z.string().nullable(),
  pack: z.object({ quantity: z.number().positive(), unit: z.enum(UNITS) }).nullable(),
  ean: z.string().nullable(),
  source: z.enum(['page', 'manual', 'stock']),
  seenAt: z.string(),
  pieces: z.number().int().positive().nullable().default(null),
  price: z.object({ value: z.number().nonnegative(), at: z.string() }).nullable().default(null),
  missingAt: z.string().nullable().default(null),
});
sameShape<z.infer<typeof productSchema>, DriveProduct>(true);

const choiceSchema = z.object({
  key: z.string(),
  enseigne: z.enum(ENSEIGNES),
  label: z.string(),
  preferred: productSchema.nullable(),
  fallback: z.array(productSchema),
  updatedAt: z.string(),
  updatedBy: authorSchema,
});
sameShape<z.infer<typeof choiceSchema>, DriveChoice>(true);

const settingsSchema = z.object({
  enseigne: z.enum(ENSEIGNES).nullable(),
  store: z.object({ name: z.string(), url: z.string().nullable() }).nullable(),
});
sameShape<z.infer<typeof settingsSchema>, DriveSettings>(true);

const amountSchema = z.object({ quantity: z.number().positive(), unit: z.enum(UNITS) });
const basketLineSchema = z.object({
  itemId: z.string(),
  key: z.string(),
  label: z.string(),
  product: z.object({ id: z.string(), name: z.string(), url: z.string() }).nullable(),
  count: z.number().int().positive(),
  per: amountSchema.nullable(),
  at: z.string(),
  by: authorSchema,
});
sameShape<z.infer<typeof basketLineSchema>, DriveBasketLine>(true);

const missingSchema = z.object({
  itemId: z.string(),
  key: z.string(),
  unavailable: z.array(z.string()),
  replacement: z.string().nullable(),
  source: z.enum(['extension', 'manual']),
  at: z.string(),
  by: authorSchema,
});
sameShape<z.infer<typeof missingSchema>, DriveMissing>(true);

const basketSchema = z.object({
  enseigne: z.enum(ENSEIGNES),
  startedAt: z.string(),
  startedBy: authorSchema,
  lines: z.array(basketLineSchema),
  missing: z.array(missingSchema).default([]),
});
sameShape<z.infer<typeof basketSchema>, DriveBasket>(true);

const fileSchema = z.object({ version: z.literal(1), settings: settingsSchema, choices: z.array(choiceSchema), basket: basketSchema.nullable().default(null) });
type DriveFile = z.infer<typeof fileSchema>;

/** Rôle d'un produit dans un choix : retenu, ou de secours. */
export type DriveRole = 'preferred' | 'fallback';

export type DriveStore = {
  settings(): Promise<DriveSettings>;
  choices(): Promise<DriveChoice[]>;
  setSettings(settings: DriveSettings): Promise<DriveSettings>;
  /**
   * Retient un produit pour un article : comme produit retenu (l'ancien devient un secours) ou comme secours (au plus
   * DRIVE_LIMITS.fallback). Un produit déjà présent dans le choix change de rôle. null : trop de choix.
   */
  choose(input: { key: string; label: string; product: DriveProduct; role: DriveRole }, by: Author): Promise<DriveChoice | null>;
  /**
   * Retire un produit d'un choix (le retenu laisse la place vide : aucun secours n'est pris d'office), ou tout le
   * choix sans `id`. false : rien à retirer.
   */
  forget(key: string, enseigne: Enseigne, id: string | null, by: Author): Promise<boolean>;
  /** Pièces dans un paquet d'un produit d'un choix (null : oublier). null : produit introuvable. */
  setPieces(key: string, enseigne: Enseigne, id: string, pieces: number | null, by: Author): Promise<DriveChoice | null>;
  /**
   * Note ce que l'extension a lu sur la fiche d'un produit d'un choix : son prix (null : rien de nouveau) et son EAN,
   * gardé seulement si le produit n'en avait pas. Retourne ce qui a été noté, ou null si le produit est introuvable.
   */
  notePage(key: string, enseigne: Enseigne, id: string, seen: { price: number | null; ean: string | null }): Promise<{ price: boolean; ean: 'set' | 'same' | 'other' | null } | null>;
  /** Panier en cours, tel qu'enregistré (les lignes ne sont pas filtrées ici). */
  basket(): Promise<DriveBasket | null>;
  /**
   * Met un article au panier (ou remplace sa ligne) ; commence un panier s'il n'y en a pas, ou si le panier est celui
   * d'une autre enseigne. `items` : identifiants des articles encore dans la liste (les autres lignes s'en vont).
   * null : panier plein.
   */
  putInBasket(enseigne: Enseigne, line: Omit<DriveBasketLine, 'at' | 'by'>, items: ReadonlySet<string>, by: Author): Promise<DriveBasket | null>;
  /** Retire un article du panier (il n'est plus marqué « au drive »). */
  takeOutOfBasket(itemId: string, items: ReadonlySet<string>): Promise<DriveBasket | null>;
  /**
   * Signale un produit d'un article introuvable ou en rupture pour le panier en cours (commencé s'il n'y en a pas) :
   * ajouté aux indisponibles de l'article ; s'il était le remplacement choisi, il ne l'est plus ; sa ligne du panier
   * s'en va si c'était ce produit ; le produit du choix en garde la trace. null : panier plein.
   */
  markMissing(input: { enseigne: Enseigne; itemId: string; key: string; productId: string; source: DriveMissing['source'] }, items: ReadonlySet<string>, by: Author): Promise<DriveBasket | null>;
  /** Retire le signalement d'un article (erreur, ou de retour en rayon), et la trace laissée sur ses produits. */
  unmarkMissing(itemId: string, items: ReadonlySet<string>): Promise<DriveBasket | null>;
  /** Remplacement choisi pour ce panier (un secours de l'article ; null : aucun). null : article non signalé. */
  setReplacement(itemId: string, replacement: string | null, items: ReadonlySet<string>): Promise<DriveBasket | null>;
  /** Nouveau panier : plus aucune ligne. */
  clearBasket(): Promise<void>;
};

export function createDriveStore({ path, clock }: { path: string; clock: Clock }): DriveStore {
  const state = createJsonFile<DriveFile>({
    path,
    schema: fileSchema,
    initial: () => ({ version: 1, settings: { enseigne: null, store: null }, choices: [], basket: null }),
    beforeSave(draft) {
      // Un choix vidé (ni retenu ni secours) disparaît.
      draft.choices = draft.choices.filter((c) => c.preferred || c.fallback.length > 0);
    },
  });

  const find = (file: DriveFile, key: string, enseigne: Enseigne) => file.choices.find((c) => c.key === key && c.enseigne === enseigne);
  const productOf = (file: DriveFile, key: string, enseigne: Enseigne, id: string) => {
    const choice = find(file, key, enseigne);
    return (choice && [choice.preferred, ...choice.fallback].find((p) => p?.id === id)) || null;
  };
  /** Panier en cours chez l'enseigne (commencé s'il n'y en a pas), sans les lignes et signalements d'articles partis. */
  const basketOf = (file: DriveFile, enseigne: Enseigne, items: ReadonlySet<string>, by: Author) => {
    if (!file.basket || file.basket.enseigne !== enseigne) file.basket = { enseigne, startedAt: clock().toISOString(), startedBy: by, lines: [], missing: [] };
    file.basket.lines = file.basket.lines.filter((l) => items.has(l.itemId));
    file.basket.missing = file.basket.missing.filter((m) => items.has(m.itemId));
    return file.basket;
  };

  return {
    async settings() {
      return (await state.read()).settings;
    },

    async choices() {
      return (await state.read()).choices;
    },

    setSettings(settings) {
      return state.update((file) => (file.settings = settings));
    },

    choose({ key, label, product, role }, by) {
      return state.update(
        (file) => {
          let choice = find(file, key, product.enseigne);
          if (!choice) {
            if (file.choices.length >= DRIVE_LIMITS.choices) return null;
            choice = { key, enseigne: product.enseigne, label, preferred: null, fallback: [], updatedAt: '', updatedBy: by };
            file.choices.push(choice);
          }
          // Les pièces par paquet déjà dites pour ce produit le suivent quand il change de rôle.
          const known = [choice.preferred, ...choice.fallback].find((p) => p?.id === product.id);
          product = { ...product, pieces: product.pieces ?? known?.pieces ?? null, price: product.price ?? known?.price ?? null, missingAt: product.missingAt ?? known?.missingAt ?? null };
          const others = choice.fallback.filter((p) => p.id !== product.id);
          if (role === 'preferred') {
            const previous = choice.preferred && choice.preferred.id !== product.id ? [choice.preferred] : [];
            choice.preferred = product;
            choice.fallback = [...previous, ...others].slice(0, DRIVE_LIMITS.fallback);
          } else {
            if (choice.preferred?.id === product.id) choice.preferred = null;
            choice.fallback = [...others, product].slice(-DRIVE_LIMITS.fallback);
          }
          Object.assign(choice, { label, updatedAt: clock().toISOString(), updatedBy: by });
          return structuredClone(choice);
        },
        (choice) => choice !== null,
      );
    },

    forget(key, enseigne, id, by) {
      return state.update(
        (file) => {
          const choice = find(file, key, enseigne);
          if (!choice) return false;
          if (id === null) {
            file.choices = file.choices.filter((c) => c !== choice);
            return true;
          }
          const before = Number(choice.preferred !== null) + choice.fallback.length;
          if (choice.preferred?.id === id) choice.preferred = null;
          choice.fallback = choice.fallback.filter((p) => p.id !== id);
          if (Number(choice.preferred !== null) + choice.fallback.length === before) return false;
          Object.assign(choice, { updatedAt: clock().toISOString(), updatedBy: by });
          return true;
        },
        (removed) => removed,
      );
    },

    setPieces(key, enseigne, id, pieces, by) {
      return state.update(
        (file) => {
          const choice = find(file, key, enseigne);
          const product = choice && [choice.preferred, ...choice.fallback].find((p) => p?.id === id);
          if (!choice || !product) return null;
          product.pieces = pieces;
          Object.assign(choice, { updatedAt: clock().toISOString(), updatedBy: by });
          return structuredClone(choice);
        },
        (choice) => choice !== null,
      );
    },

    notePage(key, enseigne, id, seen) {
      return state.update(
        (file) => {
          const choice = find(file, key, enseigne);
          const product = choice && [choice.preferred, ...choice.fallback].find((p) => p?.id === id);
          if (!product) return null;
          if (seen.price !== null) product.price = { value: seen.price, at: clock().toISOString() };
          let ean: 'set' | 'same' | 'other' | null = null;
          if (seen.ean) {
            ean = !product.ean ? 'set' : product.ean === seen.ean ? 'same' : 'other';
            if (ean === 'set') product.ean = seen.ean;
          }
          return { price: seen.price !== null, ean };
        },
        (noted) => noted !== null && (noted.price || noted.ean === 'set'),
      );
    },

    async basket() {
      return (await state.read()).basket;
    },

    putInBasket(enseigne, line, items, by) {
      return state.update(
        (file) => {
          const now = clock().toISOString();
          const basket = basketOf(file, enseigne, items, by);
          const lines = basket.lines.filter((l) => l.itemId !== line.itemId);
          if (lines.length >= DRIVE_LIMITS.basket) return null;
          basket.lines = [...lines, { ...line, at: now, by }];
          // Reparti au panier : la trace d'une rupture passée s'efface.
          const product = line.product && productOf(file, line.key, enseigne, line.product.id);
          if (product) product.missingAt = null;
          return structuredClone(basket);
        },
        (basket) => basket !== null,
      );
    },

    takeOutOfBasket(itemId, items) {
      return state.update((file) => {
        if (file.basket) file.basket.lines = file.basket.lines.filter((l) => items.has(l.itemId) && l.itemId !== itemId);
        return structuredClone(file.basket);
      });
    },

    markMissing({ enseigne, itemId, key, productId, source }, items, by) {
      return state.update(
        (file) => {
          const now = clock().toISOString();
          const basket = basketOf(file, enseigne, items, by);
          let record = basket.missing.find((m) => m.itemId === itemId);
          if (!record) {
            if (basket.missing.length >= DRIVE_LIMITS.basket) return null;
            record = { itemId, key, unavailable: [], replacement: null, source, at: now, by };
            basket.missing.push(record);
          }
          if (!record.unavailable.includes(productId)) record.unavailable.push(productId);
          if (record.replacement === productId) record.replacement = null;
          Object.assign(record, { key, source, at: now, by });
          basket.lines = basket.lines.filter((l) => l.itemId !== itemId || l.product?.id !== productId);
          const product = productOf(file, key, enseigne, productId);
          if (product) product.missingAt = now;
          return structuredClone(basket);
        },
        (basket) => basket !== null,
      );
    },

    unmarkMissing(itemId, items) {
      return state.update((file) => {
        const basket = file.basket;
        if (!basket) return null;
        const record = basket.missing.find((m) => m.itemId === itemId);
        for (const id of record?.unavailable ?? []) {
          const product = productOf(file, record!.key, basket.enseigne, id);
          if (product) product.missingAt = null;
        }
        basket.missing = basket.missing.filter((m) => items.has(m.itemId) && m.itemId !== itemId);
        return structuredClone(basket);
      });
    },

    setReplacement(itemId, replacement, items) {
      return state.update(
        (file) => {
          const record = file.basket?.missing.find((m) => m.itemId === itemId && items.has(m.itemId));
          if (!file.basket || !record) return null;
          record.replacement = replacement;
          return structuredClone(file.basket);
        },
        (basket) => basket !== null,
      );
    },

    async clearBasket() {
      await state.update((file) => (file.basket = null));
    },
  };
}
