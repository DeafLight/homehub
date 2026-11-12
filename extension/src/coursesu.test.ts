// Tests des parties pures de l'adaptateur Courses U : JSON-LD `Product` de la fiche (identifiant, EAN, prix si le
// magasin est choisi), pages de blocage (captcha, refus, connexion), quantité lue. Les sélecteurs de la page, eux,
// sont éprouvés dans Chrome sur la fausse fiche du monde fictif (scripts/extension-check.ts).
import { describe, expect, it } from 'vitest';
import { blockedReason, notFoundPage, productFromLd, quantityOf } from './coursesu.ts';

describe('JSON-LD de la fiche', () => {
  const ld = { '@context': 'https://schema.org/', '@type': 'Product', name: 'Gruyère râpé, 200g', mpn: '9990012', sku: '3000000000106' };

  it('identifiant (`mpn`), EAN (`sku`), pas de prix sans magasin', () => {
    expect(productFromLd([JSON.stringify(ld)])).toEqual({ id: '9990012', ean: '3000000000106', price: null });
  });

  it('prix de l’offre quand le magasin est choisi ; liste, `@graph`, blocs illisibles', () => {
    const withOffer = { ...ld, offers: { '@type': 'Offer', price: '2.35', priceCurrency: 'EUR' } };
    expect(productFromLd(['{pas du json', JSON.stringify([{ '@type': 'BreadcrumbList' }, withOffer])])?.price).toBe(2.35);
    expect(productFromLd([JSON.stringify({ '@graph': [{ ...ld, '@type': ['Product'], offers: [{ price: 1.9 }] }] })])).toEqual({ id: '9990012', ean: '3000000000106', price: 1.9 });
    expect(productFromLd([JSON.stringify({ '@type': 'WebSite' })])).toBeNull();
  });
});

describe('pages de blocage', () => {
  const page = { title: 'Gruyère râpé', path: '/p/gruyere/9990012.html', challenge: false };

  it('captcha visible, titre de défi ou de refus, page de connexion', () => {
    expect(blockedReason(page)).toBeNull();
    expect(blockedReason({ ...page, challenge: true })).toMatch(/Captcha/u);
    expect(blockedReason({ ...page, title: 'Just a moment...' })).toMatch(/refuse ou vérifie/u);
    expect(blockedReason({ ...page, title: 'Un instant…' })).toMatch(/refuse ou vérifie/u);
    expect(blockedReason({ ...page, title: 'Accès refusé' })).toMatch(/refuse ou vérifie/u);
    expect(blockedReason({ ...page, path: '/connexion' })).toMatch(/connecter/u);
  });
});

describe('fiche introuvable', () => {
  it('titre ou premier titre qui dit que la page n’existe plus', () => {
    expect(notFoundPage({ title: 'Page introuvable | Drive', heading: '' })).toBe(true);
    expect(notFoundPage({ title: 'Erreur', heading: 'Ce produit n’existe plus' })).toBe(true);
    expect(notFoundPage({ title: 'Erreur 404', heading: '' })).toBe(true);
    expect(notFoundPage({ title: 'Gruyère râpé, 200g', heading: 'Gruyère râpé, 200g' })).toBe(false);
    expect(notFoundPage({ title: 'Accueil', heading: 'Nos promotions' })).toBe(false);
  });
});

describe('quantité', () => {
  it('lit un champ ou un texte', () => {
    expect(quantityOf('2')).toBe(2);
    expect(quantityOf('Qté : 3')).toBe(3);
    expect(quantityOf('')).toBeNull();
    expect(quantityOf(null)).toBeNull();
  });
});
