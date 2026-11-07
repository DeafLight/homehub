// Codes-barres des produits (EAN-13, EAN-8, UPC-A, UPC-E) : vérification de la clé de contrôle, pour écarter une
// lecture fausse avant de chercher le produit. Servira au stock de la maison ; d'abord à la page de test du scan.

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

/** Même produit en UPC-A et en EAN-13 (zéro devant) : une seule forme, à 13 chiffres, pour la base et le stock. */
export function normalizeProductCode(code: string, format?: string): string {
  const full = format === 'upc_e' ? (expandUpcE(code) ?? code) : code;
  return full.length === 12 ? `0${full}` : full;
}
