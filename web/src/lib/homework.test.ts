import { describe, expect, it } from 'vitest';
import { dueText, homeworkGroups, homeworkReminder } from './homework.ts';

// Lundi 2 novembre 2026.
const morning = new Date(2026, 10, 2, 7, 30);
const evening = new Date(2026, 10, 2, 18, 0);
const hw = (id: string, due: string, done = false) => ({ id, subject: id, due, text: '', done });

describe('devoirs', () => {
  it('dit pour quand', () => {
    expect(dueText('2026-11-02', evening)).toBe('pour aujourd’hui');
    expect(dueText('2026-11-03', evening)).toBe('pour demain');
    expect(dueText('2026-11-05', evening)).toBe('pour jeudi');
    expect(dueText('2026-11-16', evening)).toBe('pour lundi 16 novembre');
  });

  it('regroupe par jour ; ceux du jour, seulement le matin', () => {
    const list = [hw('svt', '2026-11-05'), hw('fr', '2026-11-03', true), hw('maths', '2026-11-03'), hw('ce-matin', '2026-11-02'), hw('vieux', '2026-10-30')];
    expect(homeworkGroups(list, evening).map((g) => [g.title, g.left, g.items.length])).toEqual([
      ['Pour demain', 1, 2],
      ['Pour jeudi', 1, 1],
    ]);
    expect(homeworkGroups(list, morning)[0].title).toBe('Pour aujourd’hui');
  });

  it('rappel de l’accueil', () => {
    expect(homeworkReminder({ due: '2026-11-03', left: 3 }, evening)).toBe('3 devoirs pour demain');
    expect(homeworkReminder({ due: '2026-11-05', left: 1 }, evening)).toBe('1 devoir pour jeudi');
    expect(homeworkReminder(null, evening)).toBeNull();
  });
});
