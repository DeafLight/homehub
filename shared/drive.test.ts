// Tests de la logique du drive : liens des fiches produit (identifiant tiré de l'URL), contenance lue dans le nom,
// EAN, JSON-LD `Product` → produit, clé d'un article de la liste, paquets (arrondi de la liste), correspondance EAN ;
// étape 2 : pièces par paquet, paquets signalés, articles du mode « Remplir le panier » et récapitulatif.
import { describe, expect, it } from 'vitest';
import type { ShoppingItem } from './types.ts';
import {
  basketLine,
  choiceFor,
  countFlag,
  type DriveChoice,
  driveCount,
  type DriveProduct,
  driveRecap,
  type DriveView,
  drivePacks,
  fillRows,
  formatCount,
  piecesQuestion,
  piecesUnit,
  eanCheck,
  enseigneOf,
  itemKey,
  itemName,
  normalizeEan,
  packFromName,
  productFromJsonLd,
  productLink,
  storeLink,
} from './drive.ts';

const FICHE = 'https://www.coursesu.com/p/lardons-fumes-exemple/9990001.html';

describe('liens des fiches produit', () => {
  it('tire l’enseigne et l’identifiant d’une fiche Courses U, adresse nettoyée', () => {
    expect(productLink(FICHE)).toEqual({ enseigne: 'coursesu', id: '9990001', url: FICHE });
    expect(productLink(`${FICHE}?utm_source=app#avis`)).toEqual({ enseigne: 'coursesu', id: '9990001', url: FICHE });
    expect(productLink('http://coursesu.com/p/x/AB12-3.html')?.url).toBe('https://coursesu.com/p/x/AB12-3.html');
  });

  it('trouve le lien dans un texte partagé (« Regarde : https://… »)', () => {
    expect(productLink(`Regarde ce produit : ${FICHE}.`)?.id).toBe('9990001');
  });

  it('refuse une autre page du site, un autre site, un faux domaine', () => {
    expect(productLink('https://www.coursesu.com/recherche?q=lardons')).toBeNull();
    expect(productLink('https://www.coursesu.com/p/lardons/9990001')).toBeNull();
    expect(productLink('https://www.coursesu.com.exemple.test/p/x/9990001.html')).toBeNull();
    expect(productLink('https://faux-coursesu.com/p/x/9990001.html')).toBeNull();
    expect(productLink('https://cuisine.exemple.test/p/x/9990001.html')).toBeNull();
    expect(productLink('pas un lien')).toBeNull();
  });

  it('enseigne d’un lien quelconque du site, lien de la page du magasin', () => {
    expect(enseigneOf('https://www.coursesu.com/')).toBe('coursesu');
    expect(enseigneOf('https://cuisine.exemple.test/')).toBeNull();
    expect(storeLink('https://www.coursesu.com/magasin/exemple-angers?x=1', 'coursesu')).toBe('https://www.coursesu.com/magasin/exemple-angers');
    expect(storeLink('https://ailleurs.exemple.test/magasin', 'coursesu')).toBeNull();
  });
});

describe('fiche produit', () => {
  it('contenance écrite dans le nom', () => {
    expect(packFromName('Lardons fumés, 2x100g')).toBe('2x100g');
    expect(packFromName('Crème fraîche épaisse 30% MG, 20cl')).toBe('20cl');
    expect(packFromName('Lait demi-écrémé 6 x 1 L')).toBe('6 x 1 L');
    expect(packFromName('Lessive liquide')).toBeNull();
  });

  it('EAN-8 à EAN-13, complété à 13 chiffres', () => {
    expect(normalizeEan('2000000000015')).toBe('2000000000015');
    expect(normalizeEan(12345670)).toBe('0000012345670');
    expect(normalizeEan('02000000000015')).toBe('2000000000015');
    expect(normalizeEan('12345678901234')).toBeNull();
    expect(normalizeEan('abc')).toBeNull();
    expect(normalizeEan(null)).toBeNull();
  });

  it('JSON-LD Product → produit : nom, marque, EAN (sku), contenance du nom', () => {
    const link = productLink(FICHE)!;
    const node = { '@type': 'Product', name: 'Lardons fumés, 2x100g', mpn: '9990001', sku: '2000000000015', brand: { '@type': 'Brand', name: 'Ferme des Coteaux' } };
    expect(productFromJsonLd(node, link)).toEqual({ ...link, name: 'Lardons fumés, 2x100g', brand: 'Ferme des Coteaux', packText: '2x100g', ean: '2000000000015' });
  });

  it('contenance du poids quand il est lisible ; marque en texte ; sans nom : l’identifiant', () => {
    const link = productLink(FICHE)!;
    expect(productFromJsonLd({ name: 'Gruyère râpé', weight: { value: 200, unitText: 'g' }, brand: 'Exemple', gtin13: '2000000000022' }, link)).toMatchObject({
      packText: '200 g',
      brand: 'Exemple',
      ean: '2000000000022',
    });
    expect(productFromJsonLd({}, link)).toMatchObject({ name: '9990001', brand: null, packText: null, ean: null });
  });
});

describe('articles de la liste', () => {
  const menuLine = { label: 'Lardons · 350 g', menu: { week: '2026-11-02', key: 'lardon', quantities: { masse: 350 }, toTaste: false, aisle: null, sources: [] } };

  it('clé : celle de l’ingrédient du menu, sinon celle du libellé', () => {
    expect(itemKey(menuLine)).toBe('lardon');
    expect(itemKey({ label: 'Lessive' })).toBe(itemKey({ label: 'lessive' }));
    expect(itemName(menuLine)).toBe('Lardons');
    expect(itemName({ label: 'Persil (facultatif)' })).toBe('Persil');
  });

  it('paquets du produit retenu, avec l’arrondi de la liste (350 g → 2 × 200 g)', () => {
    expect(drivePacks(menuLine, { pack: { quantity: 200, unit: 'g' } })).toEqual({ count: 2, per: { quantity: 200, unit: 'g' } });
    expect(drivePacks(menuLine, { pack: { quantity: 1, unit: 'kg' } })).toEqual({ count: 1, per: { quantity: 1, unit: 'kg' } });
    // Grandeurs qui ne se comparent pas, contenance inconnue, article hors recettes : pas de paquets.
    expect(drivePacks(menuLine, { pack: { quantity: 6, unit: 'piece' } })).toBeNull();
    expect(drivePacks(menuLine, { pack: null })).toBeNull();
    expect(drivePacks({}, { pack: { quantity: 200, unit: 'g' } })).toBeNull();
  });

  it('choix par clé et par enseigne', () => {
    const choice = { key: 'lardon', enseigne: 'coursesu' } as DriveChoice;
    expect(choiceFor([choice], 'lardon', 'coursesu')).toBe(choice);
    expect(choiceFor([choice], 'oignon', 'coursesu')).toBeNull();
  });

  it('correspondance avec le stock par EAN', () => {
    expect(eanCheck('2000000000015', [{ ean: '2000000000015' }])).toBe('match');
    expect(eanCheck('2000000000015', [{ ean: '2000000000022' }])).toBe('other');
    expect(eanCheck(null, [{ ean: '2000000000015' }])).toBeNull();
    expect(eanCheck('2000000000015', [])).toBeNull();
  });
});

describe('pièces par paquet et paquets signalés', () => {
  const mark = (quantities: Record<string, number>, toTaste = false) => ({ week: '2026-11-02', key: 'oignon', quantities, toTaste, aisle: null, sources: [] });
  const oignons = { menu: mark({ piece: 5 }) };
  const filet = { pack: { quantity: 1, unit: 'kg' as const }, pieces: null };

  it('« 5 oignons » contre un filet de 1 kg : on demande les pièces, puis on calcule', () => {
    expect(piecesUnit(oignons, filet)).toBe('piece');
    expect(piecesQuestion('piece')).toBe('Combien de pièces dans ce paquet ?');
    expect(piecesQuestion('gousse')).toBe('Combien de gousses dans ce paquet ?');
    expect(driveCount(oignons, filet)).toEqual({ count: 1, per: { quantity: 1, unit: 'kg' }, flag: 'pieces' });
    expect(driveCount(oignons, { ...filet, pieces: 3 })).toEqual({ count: 2, per: { quantity: 1, unit: 'kg' }, flag: null });
    expect(drivePacks(oignons, { ...filet, pieces: 6 })).toEqual({ count: 1, per: { quantity: 1, unit: 'kg' } });
    // Contenance inconnue mais pièces dites (botte, filet sans poids) : « 2 × 3 ».
    expect(drivePacks(oignons, { pack: null, pieces: 3 })).toEqual({ count: 2, per: { quantity: 3, unit: 'piece' } });
  });

  it('rien à demander quand les grandeurs se comparent, ou pour une ligne au poids', () => {
    expect(piecesUnit(oignons, { pack: { quantity: 6, unit: 'piece' } })).toBeNull();
    expect(driveCount(oignons, { pack: { quantity: 3, unit: 'piece' }, pieces: null })).toMatchObject({ count: 2, flag: null });
    expect(piecesUnit({ menu: mark({ masse: 500 }) }, filet)).toBeNull();
    expect(piecesUnit({}, filet)).toBeNull();
  });

  it('contenance inconnue ou autre grandeur : 1 paquet, signalé ; hors recettes ou sans quantité : 1 paquet', () => {
    expect(driveCount({ menu: mark({ masse: 500 }) }, { pack: null, pieces: null })).toEqual({ count: 1, per: null, flag: 'pack' });
    expect(driveCount({ menu: mark({ volume: 200 }) }, filet)).toEqual({ count: 1, per: { quantity: 1, unit: 'kg' }, flag: 'mismatch' });
    expect(driveCount({}, filet)).toEqual({ count: 1, per: { quantity: 1, unit: 'kg' }, flag: null });
    expect(driveCount({ menu: mark({}, true) }, { pack: null, pieces: null })).toEqual({ count: 1, per: null, flag: null });
    expect(countFlag('pack')).toMatch(/Contenance inconnue/u);
    expect(countFlag(null)).toBeNull();
  });

  it('écriture des paquets', () => {
    expect(formatCount({ count: 2, per: { quantity: 200, unit: 'g' } })).toBe('2 × 200 g');
    expect(formatCount({ count: 1, per: null })).toBe('1 paquet');
    expect(formatCount({ count: 3, per: null })).toBe('3 paquets');
  });
});

describe('remplir le panier', () => {
  const by = { ownerId: 'alex', via: 'phone' } as const;
  const item = (id: string, label: string, menu?: ShoppingItem['menu'], done = false): ShoppingItem => ({ id, label, done, addedBy: by, addedAt: '', ...(menu && { menu }) });
  const lardons = item('1', 'Lardons · 350 g', { week: '2026-11-02', key: 'lardon', quantities: { masse: 350 }, toTaste: false, aisle: null, sources: [] });
  const product = (id: string): DriveProduct => ({ enseigne: 'coursesu', id, url: `https://www.coursesu.com/p/x/${id}.html`, name: `Produit ${id}`, brand: null, packText: '200 g', pack: { quantity: 200, unit: 'g' }, ean: null, source: 'manual', seenAt: '', pieces: null });
  const choice = (key: string, preferred: DriveProduct | null, fallback: DriveProduct[] = []): DriveChoice => ({ key, enseigne: 'coursesu', label: key, preferred, fallback, updatedAt: '', updatedBy: by });
  const items = [lardons, item('2', 'Lessive'), item('3', 'Persil'), item('4', 'Pain', undefined, true)];
  const view = (lines: DriveView['basket'] = null): DriveView => ({
    settings: { enseigne: 'coursesu', store: null },
    choices: [choice('lardon', product('10')), choice('lessive', null, [product('20')])],
    basket: lines,
  });

  it('articles à acheter avec leur produit, leurs paquets et leur état', () => {
    const rows = fillRows(items, view());
    expect(rows.map((r) => [r.item.id, r.status, r.count?.count ?? null])).toEqual([['1', 'ready', 2], ['2', 'fallback', null], ['3', 'none', null]]);
    expect(fillRows(items, { ...view(), settings: { enseigne: null, store: null } })).toEqual([]);
  });

  it('ligne du panier calculée depuis le produit retenu ; sans produit : 1 paquet', () => {
    expect(basketLine(lardons, choice('lardon', product('10')))).toEqual({ itemId: '1', key: 'lardon', label: 'Lardons', product: { id: '10', name: 'Produit 10', url: 'https://www.coursesu.com/p/x/10.html' }, count: 2, per: { quantity: 200, unit: 'g' } });
    expect(basketLine(item('2', 'Lessive'), null)).toMatchObject({ product: null, count: 1, per: null });
  });

  it('cochés, changés depuis, et récapitulatif', () => {
    const line = (itemId: string, count: number, productId: string | null) => ({ itemId, key: '', label: '', product: productId ? { id: productId, name: '', url: '' } : null, count, per: null, at: '', by });
    const basket = { enseigne: 'coursesu' as const, startedAt: '', startedBy: by, lines: [line('1', 1, '10'), line('3', 1, null)] };
    const rows = fillRows(items, view(basket));
    expect(rows.map((r) => [r.item.id, r.line !== null, r.changed])).toEqual([['1', true, true], ['2', false, false], ['3', true, false]]);
    const recap = driveRecap(rows);
    expect(recap.drive.map((r) => r.item.id)).toEqual(['1', '3']);
    expect(recap.toFill).toEqual([]);
    expect(recap.elsewhere.map((r) => r.item.id)).toEqual(['2']);
    expect(recap.packs).toBe(2);
    // Panier d'une autre enseigne : ignoré.
    expect(fillRows(items, view({ ...basket, enseigne: 'autre' as 'coursesu' })).some((r) => r.line)).toBe(false);
  });
});
