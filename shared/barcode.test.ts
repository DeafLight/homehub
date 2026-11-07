import { describe, expect, it } from 'vitest';
import { containerCode, ean13Modules, expandUpcE, isContainerCode, isStockCode, normalizeProductCode, validProductCode } from './barcode.ts';

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
    expect(normalizeProductCode('73513537')).toBe('0000073513537');
    // La forme sur 13 chiffres garde une clé juste : le stock l'accepte.
    expect(isStockCode(normalizeProductCode('73513537'))).toBe(true);
    expect(isStockCode('73513537')).toBe(false);
  });

  it('numérote les étiquettes des contenants hors des codes du commerce', () => {
    expect(containerCode(1)).toMatch(/^290000000001\d$/u);
    expect(isContainerCode(containerCode(42))).toBe(true);
    expect(isContainerCode('4006381333931')).toBe(false);
    expect(containerCode(1)).not.toBe(containerCode(2));
  });

  it('dessine un EAN-13 qui se relit', () => {
    const modules = ean13Modules('4006381333931');
    expect(modules).toHaveLength(95);
    expect(modules.slice(0, 3)).toBe('101');
    expect(modules.slice(45, 50)).toBe('01010');
    expect(modules.slice(-3)).toBe('101');
    // Relecture : chiffres de droite (jeu C, toujours le même), puis la parité de gauche donne le premier chiffre.
    const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    const invert = (s: string) => [...s].map((b) => (b === '1' ? '0' : '1')).join('');
    const right = Array.from({ length: 6 }, (_, i) => L.indexOf(invert(modules.slice(50 + i * 7, 57 + i * 7))));
    expect(right.join('')).toBe('333931');
    const left = Array.from({ length: 6 }, (_, i) => {
      const chunk = modules.slice(3 + i * 7, 10 + i * 7);
      const asL = L.indexOf(chunk);
      return asL >= 0 ? `${asL}L` : `${L.indexOf(invert([...chunk].reverse().join('')))}G`;
    });
    expect(left.map((d) => d[0]).join('')).toBe('006381');
    expect(left.map((d) => d[1]).join('')).toBe('LGLLGG'); // parité du premier chiffre, 4
  });
});
