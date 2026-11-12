// Codes-barres des produits (EAN-13, EAN-8, UPC-A, UPC-E) : vérification de la clé de contrôle, pour écarter une
// lecture fausse avant de chercher le produit, et forme unique sur 13 chiffres. Aussi les étiquettes des contenants
// de la maison : un EAN-13 « à usage interne » (préfixe 29, jamais porté par un produit du commerce), et ses barres ;
// et l'identifiant des produits sans code-barres (préfixe 28, même principe).

/** Formats que porte un produit du commerce, dans les noms de l'API BarcodeDetector. */
export const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

/** Clé GS1 : chiffres pondérés 3 et 1 depuis la droite (hors clé), complément à 10. */
function checkDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** UPC-E (8 chiffres) remis en UPC-A (12 chiffres), pour en vérifier la clé. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [s, d1, d2, d3, d4, d5, d6, check] = code;
  const body =
    d6 === '0' || d6 === '1' || d6 === '2' ? `${d1}${d2}${d6}0000${d3}${d4}${d5}`
    : d6 === '3' ? `${d1}${d2}${d3}00000${d4}${d5}`
    : d6 === '4' ? `${d1}${d2}${d3}${d4}00000${d5}`
    : `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${s}${body}${check}`;
}

/** Vrai si le code (EAN-13, EAN-8, UPC-A ou UPC-E) a une clé de contrôle juste. */
export function validProductCode(code: string, format?: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (format === 'upc_e') {
    const full = expandUpcE(code);
    return full !== null && validProductCode(full);
  }
  if (![8, 12, 13].includes(code.length)) return false;
  return checkDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/**
 * Une seule forme, à 13 chiffres, pour la base et le stock : UPC-A précédé d'un zéro (comme en EAN-13), EAN-8
 * complété de zéros (forme que garde Open Food Facts).
 */
export function normalizeProductCode(code: string, format?: string): string {
  const full = format === 'upc_e' ? (expandUpcE(code) ?? code) : code;
  return full.padStart(13, '0');
}

/** Code sur 13 chiffres accepté par l'API du stock (clé juste). */
export const isStockCode = (code: string) => /^\d{13}$/.test(code) && validProductCode(code);

const CONTAINER_PREFIX = '29';

/** Étiquette du `n`-ième contenant : 29, numéro sur 10 chiffres, clé. */
export function containerCode(n: number): string {
  const body = `${CONTAINER_PREFIX}${String(n).padStart(10, '0')}`;
  return `${body}${checkDigit(body)}`;
}

export const isContainerCode = (code: string) => code.startsWith(CONTAINER_PREFIX) && isStockCode(code);

const LOOSE_PREFIX = '28';

/**
 * Identifiant interne du `n`-ième produit sans code-barres (vrac, marché, fait maison) : 28, numéro sur 10 chiffres,
 * clé. Aussi « à usage interne » : jamais cherché dans une base de produits, jamais imprimé.
 */
export function looseCode(n: number): string {
  const body = `${LOOSE_PREFIX}${String(n).padStart(10, '0')}`;
  return `${body}${checkDigit(body)}`;
}

export const isLooseCode = (code: string) => code.startsWith(LOOSE_PREFIX) && isStockCode(code);

/** Numéro d'un identifiant de produit sans code-barres (inverse de looseCode). */
export const looseNumber = (code: string) => Number(code.slice(2, 12));

// Barres d'un EAN-13 : le premier chiffre choisit la parité (A ou B) des six chiffres de gauche.
const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G_CODES = L_CODES.map((c) => [...c].reverse().map((b) => (b === '1' ? '0' : '1')).join(''));
const R_CODES = L_CODES.map((c) => [...c].map((b) => (b === '1' ? '0' : '1')).join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Les 95 modules d'un EAN-13 (« 1 » : barre noire), gardes comprises. */
export function ean13Modules(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error(`EAN-13 attendu : ${code}`);
  const digits = [...code].map(Number);
  const parity = PARITY[digits[0]];
  const left = digits
    .slice(1, 7)
    .map((d, i) => (parity[i] === 'L' ? L_CODES[d] : G_CODES[d]))
    .join('');
  const right = digits
    .slice(7)
    .map((d) => R_CODES[d])
    .join('');
  return `101${left}01010${right}101`;
}
