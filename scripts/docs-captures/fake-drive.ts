// Fausse enseigne de drive du monde fictif : des fiches produit inventées servies à l'adresse des fiches Courses U
// (le vrai site n'est jamais appelé : le faux monde intercepte ses requêtes). Elles imitent la forme d'une vraie fiche
// (JSON-LD `Product`, `mpn` = identifiant, `sku` = EAN-13) ; produits, marques, identifiants, codes-barres et prix sont
// inventés, et l'allure est volontairement neutre (« Drive d'exemple »), sans rien de l'enseigne réelle. Une fiche
// répond comme un site protégé par un anti-robots (HTTP 403) : HomeHub ne contourne pas, on saisit le produit.
//
// Étape 3 (extension « Remplir le panier », scripts/extension-check.ts) : vue dans un navigateur, la fiche se comporte
// comme les hypothèses de l'adaptateur Courses U (extension/src/coursesu.ts, à confirmer lors de l'essai réel) :
// bouton « Ajouter », remplacé après une courte attente par un sélecteur de quantité (− 1 +), compteur du panier dans
// l'en-tête, prix affiché (magasin choisi), produit indisponible, page de défi anti-robots, et une page panier. Le
// panier vit dans le stockage local du faux site ; `localStorage['faux-drive-refus']` fait ignorer les clics (site qui
// attend autre chose).
// Codes-barres du gruyère et de la lessive : les mêmes que ceux du stock fictif (DOCS_FOOD, DOCS_PRODUCTS de fake-world.ts).
const GRUYERE = '3000000000106';
const LESSIVE = '3000000000052';

export const DRIVE_HOST = 'www.coursesu.com';

type FakeProduct = { slug: string; id: string; name: string; brand: string; ean: string; price: string; unavailable?: boolean };

const PRODUCTS: FakeProduct[] = [
  { slug: 'gruyere-rape-exemple', id: '9990012', name: 'Gruyère râpé Fromagerie du Val, 200g', brand: 'Fromagerie du Val', ean: GRUYERE, price: '2.35' },
  { slug: 'oignons-jaunes-exemple', id: '9990013', name: 'Oignons jaunes, filet 1kg', brand: 'Maraîchers du Val', ean: '2000000000046', price: '1.89' },
  { slug: 'lessive-liquide-exemple', id: '9990014', name: 'Lessive liquide Clair, 1,5L', brand: 'Clair', ean: LESSIVE, price: '7.90' },
  { slug: 'thon-naturel-exemple', id: '9990015', name: 'Thon au naturel Pêcheries de l’Ouest, 3x52g', brand: 'Pêcheries de l’Ouest', ean: '2000000000053', price: '3.15' },
  { slug: 'gruyere-rape-grand-exemple', id: '9990016', name: 'Gruyère râpé Fromagerie du Val, 500g', brand: 'Fromagerie du Val', ean: '2000000000060', price: '4.99' },
  { slug: 'farine-ble-exemple', id: '9990017', name: 'Farine de blé T55 Moulin du Val, 1kg', brand: 'Moulin du Val', ean: '2000000000077', price: '1.10', unavailable: true },
];

/** Fiche d'un produit inventé. */
export const driveUrl = (slug: string) => {
  const product = PRODUCTS.find((p) => p.slug === slug)!;
  return `https://${DRIVE_HOST}/p/${product.slug}/${product.id}.html`;
};

/** Produit inventé d'une fiche (pour préparer un panier d'essai). */
export const driveProduct = (slug: string) => {
  const { id, name } = PRODUCTS.find((p) => p.slug === slug)!;
  return { id, name, url: driveUrl(slug) };
};

/** Fiche que le faux site refuse de servir à HomeHub (comme un anti-robots). */
export const DRIVE_REFUSED_URL = `https://${DRIVE_HOST}/p/lait-demi-ecreme-exemple/9990099.html`;

/** Page panier du faux site. */
export const DRIVE_CART_URL = `https://${DRIVE_HOST}/panier`;

const escape = (s: string) => s.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);
const euros = (price: string) => `${price.replace('.', ',')} €`;

const STYLE = `<style>
  body { margin: 0; font: 16px/1.4 system-ui, sans-serif; background: #f4f4f1; color: #222; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 14px 32px; background: #2f3b45; color: #fff; }
  header a { color: #fff; text-decoration: none; font-weight: 600; }
  .minicart { display: inline-block; min-width: 22px; margin-left: 6px; padding: 1px 6px; border-radius: 11px; background: #e8b04b; color: #222; text-align: center; }
  main { display: flex; gap: 40px; max-width: 980px; margin: 32px auto; padding: 0 32px; }
  .photo { flex: 0 0 300px; height: 300px; border-radius: 16px; background: linear-gradient(135deg, #d9d6cb, #ece9df); }
  .info { flex: 1; } h1 { margin: 0 0 6px; font-size: 26px; } .brand { color: #666; }
  .prices { margin: 18px 0; font-size: 28px; font-weight: 700; }
  button { font: inherit; cursor: pointer; }
  .add-to-cart { padding: 12px 28px; border: 0; border-radius: 24px; background: #2f7d4f; color: #fff; font-weight: 700; }
  .quantity-stepper { display: inline-flex; align-items: center; gap: 10px; padding: 6px; border-radius: 24px; background: #2f7d4f; }
  .quantity-stepper button { width: 36px; height: 36px; border: 0; border-radius: 18px; background: #fff; font-weight: 700; }
  .quantity-stepper input { width: 40px; border: 0; background: transparent; color: #fff; font: inherit; font-weight: 700; text-align: center; }
  .not-available { padding: 12px 18px; border-radius: 12px; background: #eee; color: #8a3b2f; font-weight: 600; }
  .challenge { max-width: 520px; margin: 80px auto; text-align: center; }
  .cf-turnstile { width: 300px; height: 64px; margin: 24px auto; border: 1px solid #ccc; border-radius: 6px; background: #fafafa; }
  table { width: 100%; border-collapse: collapse; } td { padding: 10px 0; border-bottom: 1px solid #ddd; }
</style>`;

/** Comportement du faux site dans le navigateur : panier dans le stockage local, ajout qui répond après un instant. */
const SCRIPT = `<script>
  const KEY = 'faux-drive-panier';
  const cart = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const save = (c) => localStorage.setItem(KEY, JSON.stringify(c));
  const total = () => Object.values(cart()).reduce((s, l) => s + l.qty, 0);
  const counter = () => { const el = document.querySelector('.minicart-quantity'); if (el) el.textContent = String(total()); };
  function renderBuy() {
    const box = document.querySelector('.buy'); if (!box || box.dataset.unavailable) return;
    const { pid, name } = box.dataset; const qty = cart()[pid]?.qty || 0;
    box.innerHTML = qty === 0
      ? '<button type="button" class="add-to-cart">Ajouter</button>'
      : '<div class="quantity-stepper"><button type="button" class="quantity-minus" aria-label="Retirer un produit">−</button><input class="quantity" type="number" readonly value="' + qty + '"><button type="button" class="quantity-plus" aria-label="Ajouter un produit">+</button></div>';
    const change = (d) => () => {
      if (localStorage.getItem('faux-drive-refus')) return;
      setTimeout(() => { const c = cart(); const q = Math.max(0, (c[pid]?.qty || 0) + d); if (q) c[pid] = { name, qty: q, price: box.dataset.price }; else delete c[pid]; save(c); renderBuy(); counter(); }, 600);
    };
    box.querySelector('.add-to-cart')?.addEventListener('click', change(1));
    box.querySelector('.quantity-plus')?.addEventListener('click', change(1));
    box.querySelector('.quantity-minus')?.addEventListener('click', change(-1));
  }
  function renderCart() {
    const body = document.querySelector('.cart-lines'); if (!body) return;
    const lines = Object.values(cart());
    body.innerHTML = lines.map((l) => '<tr><td>' + l.name + '</td><td>× ' + l.qty + '</td><td>' + (l.qty * Number(l.price)).toFixed(2).replace('.', ',') + ' €</td></tr>').join('') || '<tr><td>Panier vide</td></tr>';
  }
  document.addEventListener('DOMContentLoaded', () => { renderBuy(); renderCart(); counter(); });
</script>`;

const page = (title: string, main: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escape(title)}</title>${STYLE}${SCRIPT}</head>
<body><header><a href="/">Drive d’exemple</a><a href="/panier">Panier <span class="minicart-quantity">0</span></a></header>${main}</body></html>`;

function productPage(product: FakeProduct): string {
  const ld = { '@context': 'https://schema.org/', '@type': 'Product', name: product.name, mpn: product.id, sku: product.ean, brand: { '@type': 'Brand', name: product.brand } };
  const buy = product.unavailable
    ? `<div class="buy" data-unavailable="1"><p class="not-available">Indisponible dans votre magasin</p></div>`
    : `<div class="buy" data-pid="${product.id}" data-name="${escape(product.name)}" data-price="${product.price}"></div>`;
  return page(
    `${product.name} | Drive d’exemple`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>
<main><div class="photo"></div><div class="info"><h1>${escape(product.name)}</h1><p class="brand">${escape(product.brand)}</p>
<div class="prices"><span class="sales"><span class="value" content="${product.price}">${euros(product.price)}</span></span></div>${buy}</div></main>`,
  );
}

/** Page de défi anti-robots, comme un site qui vérifie le navigateur. */
export const challengePage = () =>
  page('Un instant…', `<div class="challenge"><h1>Vérification de votre navigateur</h1><p>Merci de confirmer que vous êtes humain.</p><div class="cf-turnstile"></div></div>`);

const cartPage = () => page('Mon panier | Drive d’exemple', `<main><div class="info"><h1>Mon panier</h1><table><tbody class="cart-lines"></tbody></table></div></main>`);

/** Le faux site vu par HomeHub (lecture d'une fiche) ou par un navigateur (fiches, panier). */
export function fakeDriveSite(url: URL): Response {
  if (url.pathname === new URL(DRIVE_REFUSED_URL).pathname) {
    return new Response('<html><title>Un instant…</title><body>Vérification de votre navigateur</body></html>', { status: 403, headers: { 'content-type': 'text/html' } });
  }
  const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (url.pathname === new URL(DRIVE_CART_URL).pathname) return html(cartPage());
  const product = PRODUCTS.find((p) => url.pathname === `/p/${p.slug}/${p.id}.html`);
  if (!product) return html(page('Page introuvable | Drive d’exemple', '<main><h1>Page introuvable</h1></main>'), 404);
  return html(productPage(product));
}
