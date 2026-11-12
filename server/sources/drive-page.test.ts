// Tests de la lecture d'une fiche produit partagée, sur une fiche inventée (fixtures/drive) : JSON-LD `Product`,
// seulement les fiches d'une enseigne connue, redirection hors fiche refusée, refus du site signalé tel quel.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { productLink } from '../../shared/drive.ts';
import { createDriveReader, readProductPage } from './drive-page.ts';
import { PageError, type PageFetcher } from './web-page.ts';

const FICHE = 'https://www.coursesu.com/p/lardons-fumes-exemple/9990001.html';
const html = readFileSync(new URL('./fixtures/drive/fiche-produit.html', import.meta.url), 'utf8');
const bytes = new TextEncoder().encode(html);

describe('fiche produit', () => {
  it('lit le JSON-LD Product (entités décodées), après d’autres blocs JSON-LD', () => {
    expect(readProductPage(html, productLink(FICHE)!)).toEqual({
      found: true,
      product: { enseigne: 'coursesu', id: '9990001', url: FICHE, name: 'Lardons fumés Ferme des Coteaux, 2x100g', brand: 'Ferme des Coteaux', packText: '2x100g', ean: '2000000000015' },
    });
  });

  it('sans JSON-LD Product : seulement le lien', () => {
    expect(readProductPage('<html><title>Exemple</title></html>', productLink(FICHE)!)).toEqual({
      found: false,
      product: { enseigne: 'coursesu', id: '9990001', url: FICHE, name: '', brand: null, packText: null, ean: null },
    });
  });
});

describe('lecteur', () => {
  const reader = (fetchPage: PageFetcher) => createDriveReader({ fetchPage });

  it('lit la fiche une fois, à son adresse nettoyée', async () => {
    const asked: string[] = [];
    const read = await reader(async (url) => (asked.push(url), { url, contentType: 'text/html; charset=utf-8', body: bytes })).read(`${FICHE}?pk=1`);
    expect(asked).toEqual([FICHE]);
    expect(read.found && read.product.ean).toBe('2000000000015');
  });

  it('refuse sans rien lire un lien qui n’est pas une fiche produit d’une enseigne connue', async () => {
    let calls = 0;
    const r = reader(async () => (calls++, { url: '', contentType: '', body: bytes }));
    await expect(r.read('https://www.coursesu.com/recherche?q=lardons')).rejects.toMatchObject({ kind: 'invalid' });
    await expect(r.read('https://cuisine.exemple.test/p/x/1234.html')).rejects.toMatchObject({ kind: 'invalid' });
    expect(calls).toBe(0);
  });

  it('redirigée hors d’une fiche (accueil) : introuvable ; autre chose qu’une page : refusé', async () => {
    await expect(reader(async () => ({ url: 'https://www.coursesu.com/', contentType: 'text/html', body: bytes })).read(FICHE)).rejects.toMatchObject({ kind: 'not-found' });
    await expect(reader(async (url) => ({ url, contentType: 'image/png', body: bytes })).read(FICHE)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('un refus du site (Cloudflare, 403) remonte tel quel : rien n’est retenté', async () => {
    let calls = 0;
    const r = reader(async () => {
      calls++;
      throw new PageError('refused', 'Le site a refusé la lecture (HTTP 403)');
    });
    await expect(r.read(FICHE)).rejects.toMatchObject({ kind: 'refused' });
    expect(calls).toBe(1);
  });
});
