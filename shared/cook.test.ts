// Tests de « J'ai cuisiné » : la proposition par ingrédient (une fois, plusieurs fois, besoin plus grand qu'un paquet,
// paquet entamé connu, unités qui ne se comparent pas, contenant, à goût, plusieurs produits, pas en stock, sans
// produit relié, placards), la vérification des réponses, leurs effets, la fenêtre et le repas pris d'office.
import { describe, expect, it } from 'vitest';
import {
  answerEffect,
  type CookContext,
  type CookProduct,
  cookLines,
  cookWindow,
  defaultMeal,
  effectLabel,
  finishesPack,
  partialProposal,
  roundEstimate,
  validAnswer,
} from './cook.ts';
import type { MenuRecipe } from './menu.ts';
import { ingredientLines } from './recipes.ts';

const recipe = (servings: number | null, lines: string[]): MenuRecipe => {
  let n = 0;
  return { title: 'Pâtes au thon', servings, servingsUnit: null, ingredients: lines.flatMap((t) => ingredientLines(t, null, () => `l${++n}`)) };
};
const product = (code: string, name: string, count: number, per: CookProduct['per'], partial = false, opened: number | null = null): CookProduct => ({ code, name, count, per, partial, opened });
const context = (products: Record<string, CookProduct[]>, over: Partial<CookContext> = {}): CookContext => ({
  pantry: ['sel', 'poivre', 'huile'],
  products: new Map(Object.entries(products)),
  containers: new Map(),
  ...over,
});

const PATES = recipe(4, ['400 g de pâtes', '2 boîtes de thon', '20 cl de crème fraîche', '80 g de gruyère râpé', 'Persil', '1 oignon', 'Sel, poivre', '100 g de lardons']);
const STOCK = context({
  pate: [product('p1', 'Penne', 2, { quantity: 500, unit: 'g' }, true)],
  thon: [product('t1', 'Thon au naturel', 3, { quantity: 140, unit: 'g' })],
  'creme-fraiche': [product('c1', 'Crème fraîche épaisse', 1, { quantity: 20, unit: 'cl' })],
  'gruyere': [product('g1', 'Gruyère râpé', 1, { quantity: 200, unit: 'g' }, true)],
  persil: [product('s1', 'Persil plat', 1, { quantity: 1, unit: 'botte' })],
  lardon: [product('l1', 'Lardons fumés', 0, { quantity: 150, unit: 'g' })],
});

describe('cookLines', () => {
  const lines = cookLines(PATES, 4, STOCK);
  const byKey = (key: string) => lines.find((l) => l.key === key)!;

  it('range chaque ingrédient dans son cas', () => {
    expect(lines.map((l) => [l.key, l.status])).toEqual([
      ['pate', 'stock'],
      ['thon', 'stock'],
      ['creme-fraiche', 'stock'],
      ['gruyere', 'stock'],
      ['persil', 'stock'],
      ['oignon', 'untracked'],
      ['sel', 'pantry'],
      ['poivre', 'pantry'],
      ['lardon', 'absent'],
    ]);
    expect(byKey('lardon').linked).toEqual(['Lardons fumés']);
  });

  it('utilisé en une fois : − N, arrondi au paquet', () => {
    expect(byKey('creme-fraiche').options[0]).toMatchObject({ kind: 'once', proposal: { action: 'remove', count: 1 } });
    const twice = cookLines(PATES, 8, STOCK).find((l) => l.key === 'creme-fraiche')!;
    // 40 cl : deux briques, mais une seule en stock.
    expect(twice.options[0].proposal).toEqual({ action: 'remove', count: 1 });
  });

  it('utilisé en plusieurs fois : il en reste, ou paquet fini', () => {
    expect(byKey('gruyere').options[0]).toMatchObject({ kind: 'partial', proposal: { action: 'left', finished: 0, estimate: 0.5 } });
    // 400 g sur 500 g : il en reste à peu près ¼.
    expect(byKey('pate').options[0].proposal).toEqual({ action: 'left', finished: 0, estimate: 0.25 });
  });

  it('besoin plus grand qu’un paquet : N paquets finis, le suivant entamé', () => {
    const big = cookLines(PATES, 6, STOCK).find((l) => l.key === 'pate')!;
    // 600 g : un paquet fini, il en reste ¾ du second (400 g sur 500 g).
    expect(big.options[0].proposal).toEqual({ action: 'left', finished: 1, estimate: 0.75 });
  });

  it('unités qui ne se comparent pas : compteur, parti du nombre de boîtes', () => {
    expect(byKey('thon').options[0]).toMatchObject({ kind: 'count', counter: 2, proposal: { action: 'remove', count: 2 } });
    const gousse = cookLines(recipe(4, ['1 gousse d’ail']), 4, context({ ail: [product('a1', 'Ail', 1, { quantity: 250, unit: 'g' })] }));
    expect(gousse[0].options[0]).toMatchObject({ kind: 'count', counter: 1, proposal: null });
    const unknown = cookLines(recipe(4, ['200 g de riz']), 4, context({ riz: [product('r1', 'Riz', 2, null)] }));
    expect(unknown[0].options[0]).toMatchObject({ kind: 'count', proposal: null });
  });

  it('à goût ou facultatif : rien de proposé', () => {
    expect(byKey('persil').options[0]).toMatchObject({ kind: 'taste', proposal: null });
    const optional = cookLines(recipe(4, ['50 g de parmesan (facultatif)']), 4, context({ parmesan: [product('m1', 'Parmesan', 1, { quantity: 100, unit: 'g' })] }));
    expect(optional[0].options[0]).toMatchObject({ kind: 'taste', proposal: null });
  });

  it('plusieurs produits reliés : celui qui est en stock d’abord, le plus fourni', () => {
    const many = cookLines(recipe(4, ['80 g de gruyère râpé']), 4, context({
      'gruyere': [product('g0', 'Gruyère (épuisé)', 0, { quantity: 200, unit: 'g' }), product('g1', 'Gruyère râpé', 1, { quantity: 200, unit: 'g' }), product('g2', 'Emmental râpé', 2, { quantity: 150, unit: 'g' })],
    }));
    expect(many[0].options.map((o) => o.code)).toEqual(['g2', 'g1']);
  });

  it('contenant de la maison : « Vide » ou « Il en reste »', () => {
    const flour = cookLines(recipe(4, ['1 c. à s. de farine']), 4, context({ farine: [product('f1', 'Farine T55', 0, { quantity: 1, unit: 'kg' })] }, { containers: new Map([['farine', [{ id: 'b1', name: 'Bocal à farine', productCode: 'f1' }]]]) }));
    expect(flour[0].status).toBe('stock');
    expect(flour[0].options[0]).toMatchObject({ kind: 'container', name: 'Bocal à farine', proposal: { action: 'kept' } });
  });

  it('personnes : la proposition suit l’échelle', () => {
    expect(cookLines(PATES, 2, STOCK).find((l) => l.key === 'pate')!.quantities).toEqual({ masse: 200 });
    expect(cookLines(PATES, null, STOCK).find((l) => l.key === 'pate')!.quantities).toEqual({ masse: 400 });
  });
});

describe('partialProposal', () => {
  it('compte le paquet entamé pour sa part connue', () => {
    // ½ de 200 g = 100 g dans le paquet entamé ; 80 g : il en reste à peu près 20 g, soit presque rien → ¼ au plus près.
    expect(partialProposal(80, 200, 1, 0.5)).toEqual({ action: 'remove', count: 1 });
    expect(partialProposal(150, 200, 2, 0.5)).toEqual({ action: 'left', finished: 1, estimate: 0.75 });
    expect(partialProposal(50, 200, 1, 0.75)).toEqual({ action: 'left', finished: 0, estimate: 0.5 });
  });

  it('besoin plus grand que le stock : tout est fini', () => {
    expect(partialProposal(900, 200, 2, null)).toEqual({ action: 'remove', count: 2 });
    expect(partialProposal(400, 200, 2, null)).toEqual({ action: 'remove', count: 2 });
  });

  it('roundEstimate : au plus près, presque rien = fini', () => {
    expect([0.05, 0.2, 0.4, 0.6, 0.95].map(roundEstimate)).toEqual([null, 0.25, 0.5, 0.5, 0.75]);
  });
});

describe('réponses', () => {
  const [pate, thon, creme] = cookLines(PATES, 4, STOCK);

  it('vérifie chaque réponse contre la ligne', () => {
    expect(validAnswer(thon.options[0], { action: 'remove', count: 3 })).toBe(true);
    expect(validAnswer(thon.options[0], { action: 'remove', count: 4 })).toBe(false);
    expect(validAnswer(thon.options[0], { action: 'left', finished: 0, estimate: 0.5 })).toBe(false);
    expect(validAnswer(pate.options[0], { action: 'left', finished: 1, estimate: 0.25 })).toBe(true);
    expect(validAnswer(pate.options[0], { action: 'left', finished: 2, estimate: 0.25 })).toBe(false);
    expect(validAnswer(pate.options[0], { action: 'left', finished: 0, estimate: 0.3 as 0.25 })).toBe(false);
    expect(validAnswer(creme.options[0], { action: 'empty' })).toBe(false);
    expect(validAnswer(creme.options[0], { action: 'unused' })).toBe(true);
    expect(validAnswer(creme.options[0], { action: 'remove', count: 0 })).toBe(false);
  });

  it('effets sur le stock', () => {
    expect(answerEffect(thon.options[0], { action: 'remove', count: 2 })).toEqual({ code: 't1', remove: 2, opened: null, container: null });
    expect(answerEffect(pate.options[0], { action: 'left', finished: 1, estimate: 0.5 })).toEqual({ code: 'p1', remove: 1, opened: 0.5, container: null });
    expect(answerEffect(pate.options[0], { action: 'left', finished: 0, estimate: null })).toBeNull();
    expect(answerEffect(pate.options[0], { action: 'unused' })).toBeNull();
    expect(finishesPack({ action: 'left', finished: 0, estimate: 0.5 })).toBe(false);
    expect(finishesPack({ action: 'remove', count: 1 })).toBe(true);
  });

  it('libellés du bandeau', () => {
    expect(effectLabel(thon.options[0], { action: 'remove', count: 2 })).toBe('thon au naturel × 2');
    expect(effectLabel(pate.options[0], { action: 'left', finished: 0, estimate: 0.5 })).toBe('penne (il en reste ½)');
    expect(effectLabel(creme.options[0], { action: 'unused' })).toBeNull();
  });
});

describe('fenêtre et repas pris d’office', () => {
  it('semaine en cours, plus deux jours ; jamais une semaine à venir', () => {
    expect(cookWindow('2026-11-09', '2026-11-13')).toBe(true);
    expect(cookWindow('2026-11-02', '2026-11-10')).toBe(true);
    expect(cookWindow('2026-11-02', '2026-11-11')).toBe(false);
    expect(cookWindow('2026-11-16', '2026-11-13')).toBe(false);
  });

  it('aujourd’hui, sinon le plus récent pas encore cuisiné', () => {
    const meals = [
      { id: 'a', week: '2026-11-09', day: '2026-11-10', cooked: null },
      { id: 'b', week: '2026-11-09', day: '2026-11-12', cooked: null },
      { id: 'c', week: '2026-11-09', day: null, cooked: null },
      { id: 'd', week: '2026-11-09', day: '2026-11-13', cooked: null },
    ];
    expect(defaultMeal(meals, '2026-11-13')?.id).toBe('d');
    expect(defaultMeal(meals.slice(0, 3), '2026-11-13')?.id).toBe('b');
    expect(defaultMeal([meals[2]], '2026-11-13')?.id).toBe('c');
    expect(defaultMeal([{ ...meals[3], day: '2026-11-15' }], '2026-11-13')).toBeNull();
  });
});
