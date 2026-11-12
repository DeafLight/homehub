// Fausse enseigne de drive du monde fictif : des fiches produit inventées servies à l'adresse des fiches Courses U
// (le vrai site n'est jamais appelé : le faux monde intercepte ses requêtes). Elles imitent la forme d'une vraie fiche
// (JSON-LD `Product`, `mpn` = identifiant, `sku` = EAN-13) ; produits, marques, identifiants et codes-barres sont
// inventés, sans prix. Une fiche répond comme un site protégé par un anti-robots (HTTP 403) : HomeHub ne contourne
// pas, on saisit le produit.
// Codes-barres du gruyère et de la lessive : les mêmes que ceux du stock fictif (DOCS_FOOD, DOCS_PRODUCTS de fake-world.ts).
const GRUYERE = '3000000000106';
const LESSIVE = '3000000000052';

export const DRIVE_HOST = 'www.coursesu.com';

type FakeProduct = { slug: string; id: string; name: string; brand: string; ean: string };

const PRODUCTS: FakeProduct[] = [
  { slug: 'gruyere-rape-exemple', id: '9990012', name: 'Gruyère râpé Fromagerie du Val, 200g', brand: 'Fromagerie du Val', ean: GRUYERE },
  { slug: 'oignons-jaunes-exemple', id: '9990013', name: 'Oignons jaunes, filet 1kg', brand: 'Maraîchers du Val', ean: '2000000000046' },
  { slug: 'lessive-liquide-exemple', id: '9990014', name: 'Lessive liquide Clair, 1,5L', brand: 'Clair', ean: LESSIVE },
  { slug: 'thon-naturel-exemple', id: '9990015', name: 'Thon au naturel Pêcheries de l’Ouest, 3x52g', brand: 'Pêcheries de l’Ouest', ean: '2000000000053' },
  { slug: 'gruyere-rape-grand-exemple', id: '9990016', name: 'Gruyère râpé Fromagerie du Val, 500g', brand: 'Fromagerie du Val', ean: '2000000000060' },
];

/** Fiche d'un produit inventé. */
export const driveUrl = (slug: string) => {
  const product = PRODUCTS.find((p) => p.slug === slug)!;
  return `https://${DRIVE_HOST}/p/${product.slug}/${product.id}.html`;
};

/** Fiche que le faux site refuse de servir à HomeHub (comme un anti-robots). */
export const DRIVE_REFUSED_URL = `https://${DRIVE_HOST}/p/lait-demi-ecreme-exemple/9990099.html`;

export function fakeDriveSite(url: URL): Response {
  if (url.pathname === new URL(DRIVE_REFUSED_URL).pathname) {
    return new Response('<html><title>Un instant…</title><body>Vérification de votre navigateur</body></html>', { status: 403, headers: { 'content-type': 'text/html' } });
  }
  const product = PRODUCTS.find((p) => url.pathname === `/p/${p.slug}/${p.id}.html`);
  if (!product) return new Response('Page introuvable', { status: 404 });
  const ld = { '@context': 'https://schema.org/', '@type': 'Product', name: product.name, mpn: product.id, sku: product.ean, brand: { '@type': 'Brand', name: product.brand } };
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${product.name}</title>
<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>${product.name}</h1></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
