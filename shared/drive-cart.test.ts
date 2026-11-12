// Tests du format échangé avec l'extension « Remplir le panier » : panier copié depuis le mode « Remplir le panier »
// (seulement ce qui reste à mettre au panier avec un produit retenu), relecture dans l'extension (refus en entier
// d'un lien hors des fiches de l'enseigne), compte rendu recollé dans HomeHub, prix affichés lus dans la page.
import { describe, expect, it } from 'vitest';
import { CART_KIND, cartFor, formatPrice, parseCart, parsePrice, readReport, REPORT_KIND, reportSummary } from './drive-cart.ts';
import { type DriveChoice, type DriveProduct, type DriveView, fillRows } from './drive.ts';
import type { ShoppingItem } from './types.ts';

const by = { ownerId: 'alex', via: 'phone' } as const;
const FICHE = 'https://www.coursesu.com/p/gruyere-rape-exemple/9990012.html';
const item = (id: string, label: string, menu?: ShoppingItem['menu']): ShoppingItem => ({ id, label, done: false, addedBy: by, addedAt: '', ...(menu && { menu }) });
const product = (id: string, slug = 'x'): DriveProduct => ({
  enseigne: 'coursesu', id, url: `https://www.coursesu.com/p/${slug}/${id}.html`, name: `Produit ${id}`, brand: null,
  packText: '200 g', pack: { quantity: 200, unit: 'g' }, ean: null, source: 'page', seenAt: '', pieces: null, price: null,
});
const choice = (key: string, preferred: DriveProduct | null, fallback: DriveProduct[] = []): DriveChoice => ({ key, enseigne: 'coursesu', label: key, preferred, fallback, updatedAt: '', updatedBy: by });

describe('panier copié pour l’extension', () => {
  const gruyere = item('a', 'Gruyère râpé · 350 g', { week: '2026-11-02', key: 'gruyere-rape', quantities: { masse: 350 }, toTaste: false, aisle: null, sources: [] });
  const items = [gruyere, item('b', 'Lessive'), item('c', 'Persil'), item('d', 'Thon')];
  const view: DriveView = {
    settings: { enseigne: 'coursesu', store: { name: 'Super U Exemple', url: null } },
    choices: [choice('gruyere-rape', product('9990012', 'gruyere-rape-exemple')), choice('lessive', product('9990014')), choice('persil', null, [product('3')]), choice('thon', product('9990015'))],
    basket: { enseigne: 'coursesu', startedAt: '', startedBy: by, lines: [{ itemId: 'd', key: 'thon', label: 'Thon', product: null, count: 1, per: null, at: '', by }] },
  };

  it('seulement les articles avec un produit retenu, pas encore au panier, avec leurs paquets', () => {
    const cart = cartFor(fillRows(items, view), 'coursesu', 'Super U Exemple');
    expect(cart).toMatchObject({ kind: CART_KIND, version: 1, enseigne: 'coursesu', store: 'Super U Exemple' });
    expect(cart.lines).toEqual([
      { itemId: 'a', label: 'Gruyère râpé', id: '9990012', name: 'Produit 9990012', url: FICHE, count: 2 },
      { itemId: 'b', label: 'Lessive', id: '9990014', name: 'Produit 9990014', url: 'https://www.coursesu.com/p/x/9990014.html', count: 1 },
    ]);
  });

  it('relu tel quel par l’extension, même entouré de texte', () => {
    const cart = cartFor(fillRows(items, view), 'coursesu', null);
    expect(parseCart(JSON.stringify(cart))).toEqual({ ok: true, value: cart });
    expect(parseCart(`Voici : ${JSON.stringify(cart)} (fin)`)).toEqual({ ok: true, value: cart });
  });

  it('refusé en entier au moindre lien hors des fiches de l’enseigne, ou identifiant qui ne correspond pas', () => {
    const line = { itemId: 'a', label: 'Gruyère', id: '9990012', name: 'Gruyère', url: FICHE, count: 2 };
    const cart = (lines: unknown[], extra: object = {}) => JSON.stringify({ kind: CART_KIND, version: 1, enseigne: 'coursesu', store: null, lines, ...extra });
    expect(parseCart(cart([line])).ok).toBe(true);
    expect(parseCart(cart([line, { ...line, url: 'https://exemple.invalid/p/x/9990012.html' }]))).toEqual({ ok: false, error: expect.stringMatching(/Ligne 2/u) });
    expect(parseCart(cart([{ ...line, url: 'https://www.coursesu.com/recherche?q=lait' }])).ok).toBe(false);
    expect(parseCart(cart([{ ...line, url: 'javascript:alert(1)' }])).ok).toBe(false);
    expect(parseCart(cart([{ ...line, id: '1234567' }])).ok).toBe(false);
    expect(parseCart(cart([{ ...line, count: 0 }])).ok).toBe(false);
    expect(parseCart(cart([{ ...line, count: 2.5 }])).ok).toBe(false);
    expect(parseCart(cart([{ ...line, count: 51 }])).ok).toBe(false);
    expect(parseCart(cart([{ ...line, itemId: '' }])).ok).toBe(false);
    expect(parseCart(cart([]))).toEqual({ ok: false, error: expect.stringMatching(/vide/u) });
    expect(parseCart(cart([line], { version: 2 }))).toEqual({ ok: false, error: expect.stringMatching(/version/u) });
    expect(parseCart(cart([line], { enseigne: 'leclerc' })).ok).toBe(false);
    expect(parseCart('{"kind":"autre"}').ok).toBe(false);
    expect(parseCart('pas du JSON').ok).toBe(false);
  });

  it('adresse de la fiche nettoyée (suivi, ancre) avant d’être suivie', () => {
    const line = { itemId: 'a', label: 'Gruyère', id: '9990012', name: 'Gruyère', url: `${FICHE}?utm_source=x#avis`, count: 1 };
    const parsed = parseCart(JSON.stringify({ kind: CART_KIND, version: 1, enseigne: 'coursesu', store: null, lines: [line] }));
    expect(parsed.ok && parsed.value.lines[0].url).toBe(FICHE);
  });
});

describe('prix affichés', () => {
  it('lit les écritures courantes', () => {
    expect(parsePrice('2,35 €')).toBe(2.35);
    expect(parsePrice('2.35')).toBe(2.35);
    expect(parsePrice('2€35')).toBe(2.35);
    expect(parsePrice('Prix : 12 345,6 €')).toBeNull();
    expect(parsePrice('1 234,50 €')).toBe(1234.5);
    expect(parsePrice('7 €')).toBe(7);
    expect(parsePrice(3.456)).toBe(3.46);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice(-1)).toBeNull();
    expect(formatPrice(2.5)).toBe('2,50 €');
  });
});

describe('compte rendu recollé dans HomeHub', () => {
  it('reconnu à son format, résumé en une phrase', () => {
    expect(readReport(`  ${JSON.stringify({ kind: REPORT_KIND, version: 1, lines: [] })}
`).ok).toBe(true);
    expect(readReport(JSON.stringify({ kind: CART_KIND, version: 1 }))).toEqual({ ok: false, error: expect.stringMatching(/compte rendu/u) });
    expect(readReport(JSON.stringify({ kind: REPORT_KIND, version: 3 }))).toEqual({ ok: false, error: expect.stringMatching(/version/u) });
    expect(reportSummary({ marked: 2, prices: 1, ignored: [] })).toBe('2 articles marqués « au drive », 1 prix noté.');
    expect(reportSummary({ marked: 1, prices: 3, ignored: [{ name: 'Thon', reason: 'article plus dans la liste' }] })).toBe(
      '1 article marqué « au drive », 3 prix notés ; laissé de côté : Thon (article plus dans la liste).',
    );
    expect(reportSummary({ marked: 0, prices: 0, ignored: [] })).toBe('Aucun article marqué « au drive ».');
  });
});
