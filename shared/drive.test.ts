// Tests de la logique du drive : liens des fiches produit (identifiant tiré de l'URL), contenance lue dans le nom,
// EAN, JSON-LD `Product` → produit, clé d'un article de la liste, paquets (arrondi de la liste), correspondance EAN.
import { describe, expect, it } from 'vitest';
import {
  choiceFor,
  type DriveChoice,
  drivePacks,
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
