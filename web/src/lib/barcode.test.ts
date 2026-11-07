import { describe, expect, it } from 'vitest';
import { expandUpcE, normalizeProductCode, validProductCode } from './barcode.ts';

describe('codes-barres des produits', () => {
  it('vérifie la clé de contrôle (EAN-13, EAN-8, UPC-A)', () => {
    expect(validProductCode('4006381333931')).toBe(true);
    expect(validProductCode('4006381333932')).toBe(false);
    expect(validProductCode('73513537')).toBe(true);
    expect(validProductCode('036000291452')).toBe(true);
    expect(validProductCode('12345')).toBe(false);
    expect(validProductCode('40063813339a1')).toBe(false);
  });

  it('remet un UPC-E en UPC-A, et ramène tout à 13 chiffres', () => {
    expect(expandUpcE('04252614')).toBe('042100005264');
    expect(validProductCode('04252614', 'upc_e')).toBe(true);
    expect(normalizeProductCode('04252614', 'upc_e')).toBe('0042100005264');
    expect(normalizeProductCode('036000291452')).toBe('0036000291452');
    expect(normalizeProductCode('4006381333931')).toBe('4006381333931');
  });
});
