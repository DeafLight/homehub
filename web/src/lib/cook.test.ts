// Tests de l'affichage de « J'ai cuisiné » : boutons de chaque cas, proposition écrite, produit, réponses envoyées,
// « Tout comme proposé », compte du bouton du bas, marque d'un repas cuisiné, quand demander « Cuisiné ? », rappel,
// bandeau, question regroupée pour la liste de courses et annulation.
import { describe, expect, it } from 'vitest';
import type { CookLine, CookOption } from '../../../shared/cook.ts';
import {
  allAsProposed,
  answerButtons,
  asksCooked,
  asksEstimate,
  buttonOf,
  cookedLabel,
  hintText,
  mealText,
  productText,
  proposable,
  reminderText,
  repliesOf,
  resultText,
  returnedText,
  shoppingQuestion,
  stockChanges,
  uncookedPast,
  undoText,
} from './cook.ts';

const option = (over: Partial<CookOption>): CookOption => ({
  kind: 'once',
  code: 'p1',
  container: null,
  name: 'Crème fraîche',
  stock: 1,
  per: { quantity: 20, unit: 'cl' },
  partial: false,
  opened: null,
  proposal: { action: 'remove', count: 1 },
  counter: 1,
  ...over,
});
const line = (key: string, options: CookOption[], over: Partial<CookLine> = {}): CookLine => ({
  key,
  name: key,
  quantities: { masse: 400 },
  toTaste: false,
  optional: false,
  aisle: null,
  status: options.length ? 'stock' : 'untracked',
  options,
  linked: [],
  ...over,
});
const penne = option({ kind: 'partial', code: 'pen', name: 'Penne', stock: 2, per: { quantity: 500, unit: 'g' }, partial: true, proposal: { action: 'left', finished: 0, estimate: 0.25 } });
const thon = option({ kind: 'count', code: 'thon', name: 'Thon', stock: 3, per: { quantity: 140, unit: 'g' }, proposal: { action: 'remove', count: 2 }, counter: 2 });

describe('boutons de réponse', () => {
  it('une fois : retirer N ou pas utilisé, la proposition entourée', () => {
    expect(answerButtons(option({})).map((b) => [b.label, b.suggested])).toEqual([
      ['Retirer 1', true],
      ['Pas utilisé', false],
    ]);
  });

  it('plusieurs fois : paquet fini, il en reste, pas utilisé ; besoin plus grand qu’un paquet : N finis', () => {
    expect(answerButtons(penne).map((b) => [b.label, b.suggested])).toEqual([
      ['Paquet fini', false],
      ['Il en reste', true],
      ['Pas utilisé', false],
    ]);
    const big = { ...penne, proposal: { action: 'left' as const, finished: 1, estimate: 0.75 as const } };
    expect(answerButtons(big).map((b) => b.label)).toEqual(['2 finis', '1 fini, il en reste', 'Pas utilisé']);
    expect(asksEstimate(penne, { action: 'left', finished: 0, estimate: 0.5 })).toBe(true);
  });

  it('compteur, à goût, contenant', () => {
    expect(answerButtons(thon, 3)[0]).toMatchObject({ label: 'Retirer 3', suggested: false });
    expect(answerButtons(thon)[0]).toMatchObject({ label: 'Retirer 2', suggested: true });
    expect(answerButtons(option({ kind: 'taste', proposal: null })).map((b) => b.label)).toEqual(['Utilisé, fini', 'Il en reste', 'Pas utilisé']);
    expect(answerButtons(option({ kind: 'container', name: 'Bocal à farine', proposal: { action: 'kept' } })).map((b) => [b.label, b.suggested])).toEqual([
      ['Vide', false],
      ['Il en reste', true],
    ]);
    expect(buttonOf(answerButtons(penne), { action: 'left', finished: 0, estimate: 0.75 })).toBe('left');
  });
});

describe('textes d’une ligne', () => {
  it('produit et proposition', () => {
    expect(productText(penne)).toBe('Penne · 500 g · 2 en stock · s’utilise en plusieurs fois');
    expect(productText({ ...penne, opened: 0.5 })).toBe('Penne · 500 g · 2 en stock · entamé, il en reste ½');
    expect(hintText(line('pate', [penne]), penne)).toBe('Proposé : il en reste à peu près ¼ (400 g sur 500 g)');
    expect(hintText(line('creme', [option({})]), option({}))).toBe('Proposé : retirer 1 (le dernier)');
    expect(hintText(line('thon', [thon], { quantities: { boite: 2 } }), thon)).toBe('Pas de calcul possible : combien de paquets finis ? (la recette en compte 2)');
  });
});

describe('réponses envoyées', () => {
  const lines = [line('pate', [penne]), line('thon', [thon]), line('oignon', [])];

  it('seulement les lignes qui ont une réponse ; le compteur donne le nombre', () => {
    const replies = repliesOf(lines, { pate: { option: 0, answer: null, counter: 1 }, thon: { option: 0, answer: { action: 'remove', count: 2 }, counter: 3 } });
    expect(replies).toEqual([{ key: 'thon', code: 'thon', container: null, answer: { action: 'remove', count: 3 } }]);
    expect(stockChanges(replies)).toBe(1);
    expect(stockChanges([{ key: 'x', code: 'x', container: null, answer: { action: 'unused' } }])).toBe(0);
  });

  it('« Tout comme proposé » remplit les lignes sans réponse, garde les autres', () => {
    const choices = allAsProposed(lines, { thon: { option: 0, answer: { action: 'unused' }, counter: 2 } });
    expect(choices).toEqual({
      pate: { option: 0, answer: { action: 'left', finished: 0, estimate: 0.25 }, counter: 1 },
      thon: { option: 0, answer: { action: 'unused' }, counter: 2 },
    });
    expect(proposable(lines, choices)).toBe(false);
    expect(proposable(lines, {})).toBe(true);
  });
});

describe('repas cuisiné', () => {
  const nameOf = (id: string | null) => (id === 'alex' ? 'Alex' : null);

  it('marque « Cuisiné · Alex, 19 h 40 »', () => {
    const at = new Date(2026, 10, 13, 19, 40).toISOString();
    expect(cookedLabel({ at, by: { ownerId: 'alex', via: 'phone' } }, '2026-11-13', nameOf)).toBe('Cuisiné · Alex, 19 h 40');
    expect(cookedLabel({ at, by: { ownerId: null, via: 'tablet' } }, '2026-11-14', nameOf)).toBe('Cuisiné, vendredi 13, 19 h 40');
  });

  it('« Cuisiné ? » : aujourd’hui, un jour passé ou sans jour, semaine encore ouverte', () => {
    const view = { cookable: true, today: '2026-11-13' };
    expect(asksCooked({ day: '2026-11-13', cooked: undefined }, view)).toBe(true);
    expect(asksCooked({ day: null, cooked: undefined }, view)).toBe(true);
    expect(asksCooked({ day: '2026-11-14', cooked: undefined }, view)).toBe(false);
    expect(asksCooked({ day: '2026-11-12', cooked: undefined }, { ...view, cookable: false })).toBe(false);
  });

  it('rappel des repas passés pas encore notés', () => {
    const entries = [{ day: '2026-11-10', cooked: undefined }, { day: '2026-11-13', cooked: undefined }, { day: null, cooked: undefined }] as never;
    expect(uncookedPast({ cookable: true, today: '2026-11-13', entries })).toBe(1);
    expect([0, 1, 2].map(reminderText)).toEqual(['', '1 repas passé : cuisiné ?', '2 repas passés : cuisinés ?']);
    expect(mealText({ day: '2026-11-12' }, '2026-11-13')).toBe('Repas de jeudi 12');
    expect(mealText(null, '2026-11-13')).toBe('Hors menu');
  });
});

describe('après le décompte', () => {
  it('bandeau, coches retirées, question regroupée, annulation', () => {
    expect(resultText({ removed: ['penne (il en reste ¼)', 'thon × 2'], mealId: 'e1' })).toBe('Retiré du stock : penne (il en reste ¼), thon × 2');
    expect(resultText({ removed: [], mealId: 'e1' })).toBe('Noté cuisiné, rien retiré du stock');
    expect(returnedText([{ name: 'Gruyère', sources: ['Galettes'] }])).toEqual(['Gruyère : plus de paquet, de retour dans les courses pour Galettes']);
    expect(shoppingQuestion(['Crème fraîche'])).toBe('Plus de crème fraîche : sur la liste de courses ?');
    expect(shoppingQuestion(['Crème fraîche', 'Thon'])).toBe('Plus de crème fraîche ni de thon : sur la liste de courses ?');
    expect(undoText({ undone: 2, kept: [] })).toBe('Annulé');
    expect(undoText({ undone: 1, kept: ['Penne'] })).toBe('Annulé, sauf Penne : bougé depuis, à corriger sur la page Stock');
  });
});
