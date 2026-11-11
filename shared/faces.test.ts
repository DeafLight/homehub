// Tests des empreintes partagées : ressemblance, et repérage d'une série de prises anormalement uniforme.
import { describe, expect, it } from 'vitest';
import { looksUniform, meanSimilarity, similarity } from './faces.ts';

/** Empreinte de 64 valeurs, pseudo-aléatoire et reproductible, autour de `base` avec un écart `noise`. */
function embedding(seed: number, base: number[] | null = null, noise = 0.5): number[] {
  let x = seed * 9301 + 49297;
  const next = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: 64 }, (_, i) => (base ? base[i] : 0) + (next() - 0.5) * noise);
}

describe('empreintes partagées', () => {
  it('ressemblance : 1 pour la même empreinte, 0 pour des empreintes opposées ou de tailles différentes', () => {
    const a = embedding(1);
    expect(similarity(a, a)).toBe(1);
    expect(similarity(a.map(() => 1), a.map(() => -1))).toBe(0);
    expect(similarity(a, a.slice(1))).toBe(0);
  });

  it('prises d’un vrai visage qui bouge : variées, acceptées', () => {
    const face = embedding(7);
    const takes = Array.from({ length: 10 }, (_, i) => embedding(100 + i, face, 2));
    const mean = meanSimilarity(takes)!;
    expect(mean).toBeGreaterThan(0.5);
    expect(mean).toBeLessThan(0.95);
    expect(looksUniform(takes)).toBe(false);
  });

  it('prises presque identiques (tablette qui calcule mal) : refusées', () => {
    const face = embedding(7);
    const takes = Array.from({ length: 10 }, (_, i) => embedding(100 + i, face, 0.3));
    expect(meanSimilarity(takes)).toBeGreaterThan(0.97);
    expect(looksUniform(takes)).toBe(true);
  });

  it('trop peu de prises pour juger : jamais refusées', () => {
    const same = embedding(3);
    expect(meanSimilarity([same, same])).toBeNull();
    expect(looksUniform([same, same])).toBe(false);
    expect(looksUniform([])).toBe(false);
  });
});
