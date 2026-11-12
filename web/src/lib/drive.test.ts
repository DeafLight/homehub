// Tests du drive côté écran : résumé sous l'article, aperçu des paquets, correspondance EAN, lien partagé, quantité
// d'une ligne et marque « au drive » ; marque d'un article introuvable ou en rupture.
import { describe, expect, it } from 'vitest';
import type { DriveChoice, DriveProduct } from '../../../shared/drive.ts';
import { basketMark, choiceSummary, eanMessage, itemAmount, missingMark, packLabel, packsPreview, sharedProductLink } from './drive.ts';

const FICHE = 'https://www.coursesu.com/p/lardons-fumes-exemple/9990001.html';
const menu = { week: '2026-11-02', key: 'lardon', quantities: { masse: 350 }, toTaste: false, aisle: null, sources: [] };
const product = (pack: DriveProduct['pack'], packText: string | null = null): DriveProduct => ({
  enseigne: 'coursesu',
  id: '9990001',
  url: FICHE,
  name: 'Lardons fumés, 2x100g',
  brand: null,
  packText,
  pack,
  ean: null,
  source: 'page',
  seenAt: '',
  pieces: null,
  price: null,
  missingAt: null,
});
const choice = (preferred: DriveProduct | null, fallback: DriveProduct[] = []) => ({ key: 'lardon', enseigne: 'coursesu', label: 'Lardons', preferred, fallback }) as DriveChoice;

describe('drive à l’écran', () => {
  it('résumé : nom du produit et paquets pour une ligne du menu', () => {
    expect(choiceSummary({ menu }, choice(product({ quantity: 200, unit: 'g' })))).toBe('Lardons fumés, 2x100g · 2 × 200 g');
    expect(choiceSummary({}, choice(product({ quantity: 200, unit: 'g' })))).toBe('Lardons fumés, 2x100g');
    expect(choiceSummary({ menu }, choice(product(null)))).toBe('Lardons fumés, 2x100g');
    expect(choiceSummary({ menu }, null)).toBeNull();
  });

  it('résumé : seulement des secours, aucun pris d’office', () => {
    expect(choiceSummary({ menu }, choice(null, [product(null)]))).toBe('Produit à choisir (1 secours)');
    expect(choiceSummary({ menu }, choice(null, [product(null), product(null)]))).toBe('Produit à choisir (2 secours)');
  });

  it('aperçu des paquets pendant la saisie', () => {
    expect(packsPreview({ menu }, '2x100g')).toBe('2 × 200 g pour 350 g');
    expect(packsPreview({ menu }, '1 kg')).toBe('1 × 1 kg pour 350 g');
    expect(packsPreview({ menu }, 'barquette')).toBeNull();
    expect(packsPreview({}, '200 g')).toBeNull();
  });

  it('contenance affichée', () => {
    expect(packLabel(product({ quantity: 200, unit: 'g' }, '2x100g'))).toBe('2x100g');
    expect(packLabel(product(null, 'barquette'))).toBe('barquette (illisible)');
    expect(packLabel(product(null))).toBe('Contenance inconnue');
  });

  it('correspondance avec le stock', () => {
    const hints = [{ ean: '2000000000015', name: 'Lardons', brand: null, quantity: null }];
    expect(eanMessage('2000000000015', hints)?.ok).toBe(true);
    expect(eanMessage('2000000000022', hints)?.ok).toBe(false);
    expect(eanMessage(null, hints)).toBeNull();
  });

  it('lien partagé : fiche produit seulement', () => {
    expect(sharedProductLink(new URLSearchParams({ text: `Lardons ${FICHE}?x=1` }))).toBe(FICHE);
    expect(sharedProductLink(new URLSearchParams({ url: 'https://cuisine.exemple.test/recette' }))).toBeNull();
    expect(sharedProductLink(new URLSearchParams({ url: 'https://www.coursesu.com/' }))).toBeNull();
  });
});

describe('panier en cours', () => {
  const by = { ownerId: 'alex', via: 'phone' } as const;
  const view = (enseigne: 'coursesu' | null = 'coursesu') => ({
    settings: { enseigne, store: null },
    choices: [],
    basket: { enseigne: 'coursesu' as const, startedAt: '', startedBy: by, missing: [], lines: [{ itemId: '1', key: 'lardon', label: 'Lardons', product: { id: '9990001', name: 'Lardons fumés', url: FICHE }, count: 2, per: { quantity: 200, unit: 'g' as const }, at: '', by }, { itemId: '2', key: 'lessive', label: 'Lessive', product: null, count: 1, per: null, at: '', by }] },
  });

  it('marque « au drive » d’un article mis au panier, avec le produit et les paquets', () => {
    expect(basketMark(view(), { id: '1' })).toBe('Au drive : Lardons fumés · 2 × 200 g');
    expect(basketMark(view(), { id: '2' })).toBe('Au drive · 1 paquet');
    expect(basketMark(view(), { id: '3' })).toBeNull();
    expect(basketMark(view(null), { id: '1' })).toBeNull();
  });

  it('quantité écrite après le nom', () => {
    expect(itemAmount({ label: 'Lardons · 350 g' })).toBe('350 g');
    expect(itemAmount({ label: 'Lessive' })).toBeNull();
  });
});

describe('article introuvable ou en rupture', () => {
  const by = { ownerId: 'alex', via: 'phone' } as const;
  const other = { ...product({ quantity: 200, unit: 'g' }), id: '9990002', name: 'Lardons nature, 200g' };
  const view = (replacement: string | null, unavailable = ['9990001']) => ({
    settings: { enseigne: 'coursesu' as const, store: null },
    choices: [choice(product({ quantity: 200, unit: 'g' }), [other])],
    basket: { enseigne: 'coursesu' as const, startedAt: '', startedBy: by, lines: [], missing: [{ itemId: '1', key: 'lardon', unavailable, replacement, source: 'manual' as const, at: '', by }] },
  });
  const item = { id: '1', label: 'Lardons · 350 g', menu };

  it('signalé dans la liste classique : à remplacer, ou remplacé ; rien si le signalement est caduc', () => {
    expect(missingMark(view(null), item)).toBe('Introuvable ou en rupture : Lardons fumés, 2x100g · à remplacer');
    expect(missingMark(view('9990002'), item)).toBe('Remplacé par Lardons nature, 200g (Lardons fumés, 2x100g en rupture)');
    expect(missingMark(view(null, ['1234']), item)).toBeNull();
    expect(missingMark(view(null), { ...item, id: '2' })).toBeNull();
  });
});
