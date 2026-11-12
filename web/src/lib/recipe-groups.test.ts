// Tests des groupes de notre version : identifiants et ordre gardés, lignes d'un groupe qui se suivent, lignes sans
// groupe en tête.
import { describe, expect, it } from 'vitest';
import { cleanGroupName, groupNames, insertInGroup, moveGroup, moveInGroups, moveToGroup, removeGroup, renameGroup } from './recipe-groups.ts';

type Line = { id: string; section: string | null };

/** « a b | Pâte: c d | Garniture: e » → lignes. */
function lines(spec: string): Line[] {
  return spec.split('|').flatMap((part) => {
    const [head, rest] = part.includes(':') ? part.split(':') : [null, part];
    return rest.trim().split(/\s+/u).filter(Boolean).map((id) => ({ id, section: head?.trim() ?? null }));
  });
}
const show = (items: Line[]) => items.map((x) => (x.section ? `${x.section}/${x.id}` : x.id)).join(' ');

describe('groupes de notre version', () => {
  const base = lines('a | Pâte: b c | Garniture: d e');

  it('nomme et liste les groupes', () => {
    expect(cleanGroupName('  Pour   la pâte ')).toBe('Pour la pâte');
    expect(cleanGroupName('   ')).toBeNull();
    expect(cleanGroupName('x'.repeat(300))).toHaveLength(120);
    expect(groupNames(base)).toEqual(['Pâte', 'Garniture']);
  });

  it('range une ligne dans un groupe, ou l’en sort vers la tête', () => {
    expect(show(moveToGroup(base, 'a', 'Garniture'))).toBe('Pâte/b Pâte/c Garniture/d Garniture/e Garniture/a');
    expect(show(moveToGroup(base, 'd', null))).toBe('a d Pâte/b Pâte/c Garniture/e');
    expect(show(moveToGroup(base, 'b', 'Sauce'))).toBe('a Pâte/c Garniture/d Garniture/e Sauce/b');
    expect(show(moveToGroup(lines('Pâte: b'), 'b', null))).toBe('b');
    expect(moveToGroup(base, 'inconnu', 'Pâte')).toEqual(base);
  });

  it('ajoute des lignes à la fin d’un groupe', () => {
    expect(show(insertInGroup(base, [{ id: 'x', section: null }], 'Pâte'))).toBe('a Pâte/b Pâte/c Pâte/x Garniture/d Garniture/e');
    expect(show(insertInGroup(base, [{ id: 'x', section: 'Pâte' }], null))).toBe('a x Pâte/b Pâte/c Garniture/d Garniture/e');
    expect(show(insertInGroup(lines('Pâte: b'), [{ id: 'x', section: null }], null))).toBe('x Pâte/b');
  });

  it('monte et descend une ligne, qui change de groupe à la limite sans changer de place', () => {
    expect(show(moveInGroups(base, 2, -1))).toBe('a Pâte/c Pâte/b Garniture/d Garniture/e');
    expect(show(moveInGroups(base, 3, -1))).toBe('a Pâte/b Pâte/c Pâte/d Garniture/e');
    expect(show(moveInGroups(base, 1, -1))).toBe('a b Pâte/c Garniture/d Garniture/e');
    expect(show(moveInGroups(base, 2, 1))).toBe('a Pâte/b Garniture/c Garniture/d Garniture/e');
    expect(moveInGroups(base, 0, -1)).toEqual(base);
    expect(moveInGroups(base, 4, 1)).toEqual(base);
  });

  it('retire un groupe : ses lignes rejoignent le groupe d’avant', () => {
    expect(show(removeGroup(base, 'Garniture'))).toBe('a Pâte/b Pâte/c Pâte/d Pâte/e');
    expect(show(removeGroup(base, 'Pâte'))).toBe('a b c Garniture/d Garniture/e');
    expect(show(removeGroup(lines('Pâte: b | Garniture: d'), 'Pâte'))).toBe('b Garniture/d');
  });

  it('renomme un groupe, le réunit à un autre du même nom, ou le retire avec un nom vide', () => {
    expect(show(renameGroup(base, 'Pâte', ' Pour la pâte '))).toBe('a Pour la pâte/b Pour la pâte/c Garniture/d Garniture/e');
    expect(show(renameGroup(base, 'Garniture', 'Pâte'))).toBe('a Pâte/b Pâte/c Pâte/d Pâte/e');
    expect(show(renameGroup(base, 'Pâte', 'Garniture'))).toBe('a Garniture/d Garniture/e Garniture/b Garniture/c');
    expect(show(renameGroup(base, 'Pâte', ''))).toBe('a b c Garniture/d Garniture/e');
    expect(renameGroup(base, 'Pâte', 'Pâte')).toEqual(base);
  });

  it('déplace un groupe entier, jamais avant les lignes sans groupe', () => {
    expect(show(moveGroup(base, 'Garniture', -1))).toBe('a Garniture/d Garniture/e Pâte/b Pâte/c');
    expect(show(moveGroup(base, 'Pâte', 1))).toBe('a Garniture/d Garniture/e Pâte/b Pâte/c');
    expect(moveGroup(base, 'Pâte', -1)).toEqual(base);
    expect(moveGroup(base, 'Garniture', 1)).toEqual(base);
  });

  it('garde les identifiants et les autres champs des lignes', () => {
    const rich = [
      { id: 'l1', section: null, text: '200 g de farine', quantity: 200 },
      { id: 'l2', section: 'Pâte', text: '2 œufs', quantity: 2 },
    ];
    const moved = moveToGroup(rich, 'l1', 'Pâte');
    expect(moved.map((x) => x.id).sort()).toEqual(['l1', 'l2']);
    expect(moved.find((x) => x.id === 'l1')).toEqual({ id: 'l1', section: 'Pâte', text: '200 g de farine', quantity: 200 });
    expect(rich[0].section).toBeNull();
  });
});
