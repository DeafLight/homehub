// Lecture d'une fiche produit d'une enseigne, une fois, à la demande de la personne qui l'a partagée (jamais de
// recherche dans le catalogue, jamais de lecture en série). Seules les fiches produit d'une enseigne connue se lisent
// (chez Courses U, `/p/` est autorisé aux robots par son robots.txt) ; par le lecteur de pages habituel (contrôle des
// adresses, User-Agent honnête), qui signale un refus du site (Cloudflare, 403…) sans jamais le contourner. On garde
// le JSON-LD `Product` : nom, marque, contenance, EAN ; ni prix ni image.
import { type DriveProductDraft, productFromJsonLd, productLink } from '../../shared/drive.ts';
import { decodeEntities, decodePage, jsonLdNode } from './recipe-page.ts';
import { PageError, type PageFetcher } from './web-page.ts';

export type DriveRead = { found: true; product: DriveProductDraft } | { found: false; product: DriveProductDraft };

/** Fiche reçue (HTML) → brouillon de produit ; sans JSON-LD `Product` lisible, seulement ce que dit le lien. */
export function readProductPage(html: string, link: NonNullable<ReturnType<typeof productLink>>): DriveRead {
  const node = jsonLdNode(html, 'Product');
  if (!node) return { found: false, product: { ...link, name: '', brand: null, packText: null, ean: null } };
  const product = productFromJsonLd(node, link);
  return { found: true, product: { ...product, name: decodeEntities(product.name), brand: product.brand && decodeEntities(product.brand) } };
}

export type DriveReader = { read(url: string): Promise<DriveRead> };

export function createDriveReader({ fetchPage }: { fetchPage: PageFetcher }): DriveReader {
  return {
    async read(url) {
      const link = productLink(url);
      if (!link) throw new PageError('invalid', 'Lien d’une fiche produit attendu');
      const page = await fetchPage(link.url, { maxBytes: 3_000_000 });
      // Redirigée ailleurs que vers une fiche de la même enseigne (accueil, autre site) : on ne lit pas.
      const final = productLink(page.url);
      if (!final || final.enseigne !== link.enseigne) throw new PageError('not-found', 'La fiche n’existe plus à cette adresse');
      const type = page.contentType.split(';')[0].trim().toLowerCase();
      if (type && !/html|xml/u.test(type)) throw new PageError('invalid', 'Ce lien ne mène pas à une page web');
      return readProductPage(decodePage(page.body, page.contentType), final);
    },
  };
}
