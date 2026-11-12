// Extension « Remplir le panier » : adaptateur Courses U, la seule partie qui connaît la page de l'enseigne.
//
// ⚠ À CONFIRMER LORS DE L'ESSAI RÉEL. La structure de la fiche une fois connecté (bouton « Ajouter », sélecteur de
// quantité, compteur du panier, prix) n'a pas été vue : HomeHub n'a jamais ouvert de session sur le site. Ce qui est
// sûr (lu sur une fiche publique, voir docs/etude-drive.md) : l'adresse `/p/<nom>/<identifiant>.html` et le JSON-LD
// `Product` (`mpn` = identifiant, `sku` = EAN). Le reste est une hypothèse raisonnable (site Salesforce Commerce Cloud,
// boutons reconnus aussi à leur texte) ; les sélecteurs sont tous dans SELECTORS, à corriger après l'essai.
// La fausse fiche du monde fictif (scripts/docs-captures/fake-drive.ts) suit ces hypothèses.
//
// Ce que fait l'adaptateur : lire la page (fiche attendue ? captcha ? quantité déjà au panier ? prix ?) et cliquer le
// bouton « Ajouter » puis « + » de la fiche, comme la personne le ferait, en attendant chaque fois que le site
// réponde. Jamais d'appel direct aux points d'entrée du site (ni `Cart-AddProduct`, ni ceux « partenaire »).
import { parsePrice } from '../../shared/drive-cart.ts';
import { normalizeEan, productLink } from '../../shared/drive.ts';
import type { Page } from './run.ts';

export const SELECTORS = {
  /** Bouton « Ajouter » de la fiche (sinon : un bouton dont le texte est ADD_TEXT). */
  addButton: ['button.add-to-cart', 'button[data-action="add-to-cart"]', '[data-testid="add-to-cart"]'],
  /** Sélecteur de quantité qui remplace le bouton une fois le produit au panier, son champ et son bouton « + ». */
  stepper: ['.quantity-stepper', '.product-quantity', '[data-testid="quantity-selector"]'],
  quantity: ['input.quantity', 'input[name="quantity"]', 'input[type="number"]', '.quantity-value'],
  plus: ['button.quantity-plus', 'button[data-action="increase"]', 'button[aria-label*="ajouter" i]', 'button[aria-label*="augmenter" i]'],
  /** Compteur du panier dans l'en-tête (preuve de secours qu'un ajout est passé). */
  minicart: ['.minicart-quantity', '.minicart .quantity', '[data-testid="cart-count"]'],
  /** Prix affiché d'un paquet (attribut `content`, sinon le texte). */
  price: ['.prices .sales .value', '.product-price .value', '[itemprop="price"]', '.price .value'],
  /** Produit indisponible au magasin choisi. */
  unavailable: ['.not-available', '.out-of-stock', '[data-availability="out_of_stock"]'],
  /** Défis anti-robots : Cloudflare, captchas courants (visibles seulement). */
  challenge: [
    'iframe[src*="challenges.cloudflare.com"]',
    '#challenge-form',
    '#cf-challenge-running',
    '.cf-turnstile',
    'iframe[src*="captcha" i]',
    '.g-recaptcha',
    '.h-captcha',
    '[id*="captcha" i]',
    '[class*="captcha" i]',
  ],
} as const;

const ADD_TEXT = /^\+?\s*ajouter(\s+au\s+panier)?$/iu;
const UNAVAILABLE_TEXT = /indisponible|en rupture|plus disponible|victime de son succès/iu;
const BLOCKED_TITLE = /just a moment|un instant|attention required|access denied|accès refusé|vérification|too many requests|trop de requêtes/iu;
const LOGIN_PATH = /\/(connexion|login|identification|authentification)\b/iu;

const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/gu, ' ').trim();

/** Élément affiché (pas caché, a une taille). */
function visible(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const html = el as HTMLElement;
  if (html.hidden || html.closest('[hidden], [aria-hidden="true"]')) return false;
  return html.getClientRects().length > 0;
}

const first = (root: ParentNode, selectors: readonly string[]): HTMLElement | null => {
  for (const selector of selectors) {
    const el = [...root.querySelectorAll(selector)].find(visible);
    if (el) return el as HTMLElement;
  }
  return null;
};

const enabled = (el: HTMLElement | null): el is HTMLElement => !!el && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';

// --- Parties pures (testées sans navigateur).

type LdProduct = { id: string | null; ean: string | null; price: number | null };

/** JSON-LD `Product` parmi les blocs `application/ld+json` de la page (objet, liste, ou `@graph`). */
export function productFromLd(blocks: readonly string[]): LdProduct | null {
  const nodes: unknown[] = [];
  for (const text of blocks) {
    try {
      const data = JSON.parse(text) as unknown;
      const list = Array.isArray(data) ? data : [data];
      for (const node of list) nodes.push(node, ...((node as { '@graph'?: unknown[] })?.['@graph'] ?? []));
    } catch {
      // Bloc illisible : ignoré.
    }
  }
  const product = nodes.find((n): n is Record<string, unknown> => {
    const type = (n as { '@type'?: unknown })?.['@type'];
    return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  });
  if (!product) return null;
  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const mpn = typeof product.mpn === 'string' || typeof product.mpn === 'number' ? String(product.mpn).trim() : '';
  return {
    id: mpn || null,
    ean: normalizeEan(product.sku) ?? normalizeEan(product.gtin13) ?? normalizeEan(product.gtin),
    price: offers && typeof offers === 'object' ? parsePrice((offers as Record<string, unknown>).price) : null,
  };
}

/** La page est-elle un défi anti-robots, un refus ou une page de connexion ? La raison, ou null. */
export function blockedReason(page: { title: string; path: string; status?: string; challenge: boolean }): string | null {
  if (page.challenge) return 'Captcha ou vérification anti-robots affichée par le site';
  if (BLOCKED_TITLE.test(page.title)) return `Le site refuse ou vérifie (« ${clean(page.title).slice(0, 60)} »)`;
  if (LOGIN_PATH.test(page.path)) return 'Le site demande de se connecter : connecte-toi, puis reprends';
  return null;
}

/** Quantité lue dans un champ ou un texte (« 2 », « Qté : 2 ») ; null si illisible. */
export function quantityOf(value: string | null | undefined): number | null {
  const m = /\d+/u.exec(value ?? '');
  return m ? Number(m[0]) : null;
}

// --- Lecture de la page.

function challengeShown(doc: Document): boolean {
  return SELECTORS.challenge.some((s) => [...doc.querySelectorAll(s)].some(visible));
}

function addButton(doc: Document): HTMLElement | null {
  return first(doc, SELECTORS.addButton) ?? ([...doc.querySelectorAll('button')].find((b) => visible(b) && ADD_TEXT.test(clean(b.textContent))) as HTMLElement | undefined) ?? null;
}

function stepper(doc: Document): HTMLElement | null {
  return first(doc, SELECTORS.stepper);
}

/** Paquets au panier d'après le sélecteur de quantité de la fiche ; 0 si le bouton « Ajouter » est là ; null sinon. */
function inCartQuantity(doc: Document): number | null {
  const box = stepper(doc);
  if (box) {
    const field = first(box, SELECTORS.quantity);
    const value = field instanceof HTMLInputElement ? field.value : field?.textContent;
    const n = quantityOf(value);
    if (n !== null) return n;
  }
  return addButton(doc) ? 0 : null;
}

function plusButton(doc: Document): HTMLElement | null {
  const box = stepper(doc);
  if (!box) return null;
  return first(box, SELECTORS.plus) ?? ([...box.querySelectorAll('button')].find((b) => visible(b) && clean(b.textContent) === '+') as HTMLElement | undefined) ?? null;
}

const minicartCount = (doc: Document) => quantityOf(first(doc, SELECTORS.minicart)?.textContent);

function shownPrice(doc: Document): number | null {
  const el = first(doc, SELECTORS.price);
  return el ? (parsePrice(el.getAttribute('content')) ?? parsePrice(clean(el.textContent))) : null;
}

export function blocked(doc: Document, loc: Location): string | null {
  return blockedReason({ title: doc.title, path: loc.pathname, challenge: challengeShown(doc) });
}

/** Ce que montre la page ouverte. */
export function inspect(doc: Document, loc: Location): Page {
  const reason = blocked(doc, loc);
  if (reason) return { kind: 'blocked', reason };
  const fromUrl = productLink(loc.href);
  const ld = productFromLd([...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? ''));
  if (!ld) return { kind: 'other', what: fromUrl ? 'fiche sans description du produit lisible' : `page ${loc.pathname}` };
  const add = addButton(doc);
  const plus = plusButton(doc);
  const canAdd = enabled(add) || enabled(plus);
  const unavailable = !canAdd && (!!first(doc, SELECTORS.unavailable) || UNAVAILABLE_TEXT.test(clean(doc.querySelector('main')?.textContent ?? doc.body?.textContent)));
  return {
    kind: 'product',
    id: ld.id ?? fromUrl?.id ?? null,
    ean: ld.ean,
    price: ld.price ?? shownPrice(doc),
    inCart: inCartQuantity(doc),
    canAdd,
    unavailable,
  };
}

// --- Ajout au panier, en cliquant les boutons de la fiche.

export type AddResult = { ok: true; inCart: number } | { ok: false; reason: string; inCart: number };
type Options = { pace: { betweenClicks: number; confirm: number }; doc: Document; loc: Location; sleep: (ms: number) => Promise<void>; stopped: () => Promise<boolean> };

/** Attend que `done` soit vrai (ou un blocage, ou l'arrêt demandé), au plus `timeout` ms. */
async function waitFor(done: () => boolean, { doc, loc, sleep, stopped }: Options, timeout: number): Promise<'ok' | 'timeout' | 'stopped' | string> {
  for (let waited = 0; waited <= timeout; waited += 250) {
    const reason = blocked(doc, loc);
    if (reason) return reason;
    if (done()) return 'ok';
    if (await stopped()) return 'stopped';
    await sleep(250);
  }
  return 'timeout';
}

/**
 * Met `clicks` paquets de plus au panier depuis la fiche : « Ajouter » si le produit n'y est pas (`first`), puis « + ».
 * Chaque clic attend la réponse du site (quantité de la fiche ou compteur du panier qui monte) ; pas de réponse,
 * captcha ou page qui change : on s'arrête et on dit où on en est.
 */
export async function addToCart(clicks: number, firstClick: boolean, from: number, options: Options): Promise<AddResult> {
  const { doc, pace, sleep } = options;
  let inCart = from;
  for (let i = 0; i < clicks; i++) {
    if (i > 0) await sleep(pace.betweenClicks);
    const before = { qty: inCartQuantity(doc) ?? inCart, cart: minicartCount(doc) };
    const button = firstClick && i === 0 ? addButton(doc) : (plusButton(doc) ?? (stepper(doc) ? null : addButton(doc)));
    if (!enabled(button)) return { ok: false, reason: i === 0 ? 'Bouton « Ajouter » introuvable ou grisé' : 'Bouton « + » introuvable ou grisé : quantité à finir à la main', inCart };
    button.click();
    const answer = await waitFor(
      () => {
        const qty = inCartQuantity(doc);
        const cart = minicartCount(doc);
        return (qty !== null && qty > before.qty) || (before.cart !== null && cart !== null && cart > before.cart);
      },
      options,
      pace.confirm,
    );
    if (answer === 'stopped') return { ok: false, reason: 'Arrêté par toi', inCart };
    if (answer === 'timeout') return { ok: false, reason: 'Le site n’a pas confirmé l’ajout (choix du magasin, connexion, message ?) : à finir à la main', inCart };
    if (answer !== 'ok') return { ok: false, reason: answer, inCart };
    inCart = Math.max(inCart + 1, inCartQuantity(doc) ?? 0);
  }
  return { ok: true, inCart };
}
