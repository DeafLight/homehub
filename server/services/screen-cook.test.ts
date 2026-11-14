// Tests du mode cuisine des télés en mémoire : lancement, étape ramenée dans la recette, fin, attente réveillée par un
// changement d'étape ou au bout du délai, révision jamais reprise par un nouveau mode cuisine.
import { describe, expect, it } from 'vitest';
import { createScreenCooking } from './screen-cook.ts';

const BY = { ownerId: 'alex', via: 'phone' } as const;

describe('mode cuisine des télés', () => {
  it('lancement, étape, fin', () => {
    const cooking = createScreenCooking();
    const first = cooking.start('tv', 'r1', 0, BY);
    expect(cooking.get('tv')).toEqual({ recipeId: 'r1', index: 0, rev: first.rev, by: BY });
    expect(cooking.step('tv', 2, 5)?.index).toBe(2);
    expect(cooking.step('tv', 9, 5)?.index).toBe(4);
    expect(cooking.step('tv', -1, 5)?.index).toBe(0);
    expect(cooking.step('autre', 1, 5)).toBeNull();
    expect(cooking.stop('tv')).toBe(true);
    expect(cooking.stop('tv')).toBe(false);
    expect(cooking.get('tv')).toBeNull();
  });

  it('même étape : révision inchangée ; nouveau mode cuisine : révision nouvelle', () => {
    const cooking = createScreenCooking();
    const { rev } = cooking.start('tv', 'r1', 1, BY);
    expect(cooking.step('tv', 1, 5)?.rev).toBe(rev);
    cooking.stop('tv');
    expect(cooking.start('tv', 'r1', 1, BY).rev).toBeGreaterThan(rev + 1);
  });

  it('attente : tout de suite au départ ou si la révision a changé, réveillée par une étape, sinon au bout du délai', async () => {
    const cooking = createScreenCooking({ waitMs: 40 });
    const { rev } = cooking.start('tv', 'r1', 0, BY);
    await cooking.wait('tv', null);
    await cooking.wait('tv', rev - 1);
    const started = performance.now();
    const waiting = cooking.wait('tv', rev);
    setTimeout(() => cooking.step('tv', 1, 3), 5);
    await waiting;
    expect(performance.now() - started).toBeLessThan(35);
    const quiet = performance.now();
    await cooking.wait('tv', cooking.get('tv')!.rev);
    expect(performance.now() - quiet).toBeGreaterThanOrEqual(35);
  });

  it('fin du mode cuisine : l’attente se réveille', async () => {
    const cooking = createScreenCooking({ waitMs: 5_000 });
    const { rev } = cooking.start('tv', 'r1', 0, BY);
    const waiting = cooking.wait('tv', rev);
    cooking.stop('tv');
    await waiting;
    await cooking.wait('tv', rev);
  });
});
