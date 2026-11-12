// Tests du drive côté écran : résumé sous l'article, aperçu des paquets, correspondance EAN, lien partagé.
import { describe, expect, it } from 'vitest';
import type { DriveChoice, DriveProduct } from '../../../shared/drive.ts';
import { choiceSummary, eanMessage, packLabel, packsPreview, sharedProductLink } from './drive.ts';

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
