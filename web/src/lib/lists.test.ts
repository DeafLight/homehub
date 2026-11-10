import { describe, expect, it } from 'vitest';
import type { ListTask } from '../../../shared/types.ts';
import { dueLabel, isLate, repeatLabel, sharedText, taskMeta } from './lists.ts';

/** Lundi 2 novembre 2026, 18:00. */
const now = new Date(2026, 10, 2, 18, 0);
const names: Record<string, string> = { lea: 'Léa', sam: 'Sam' };
const nameOf = (id: string | null) => (id ? (names[id] ?? null) : null);

const task = (patch: Partial<ListTask> = {}): ListTask => ({
  id: 't',
  label: 'Poubelles',
  ownerId: 'tom',
  due: null,
  repeat: null,
  done: false,
  addedBy: { ownerId: 'sam', via: 'phone' },
  addedAt: now.toISOString(),
  ...patch,
});

describe('listes', () => {
  it('échéances', () => {
    expect(dueLabel('2026-11-02', now)).toBe('Aujourd’hui');
    expect(dueLabel('2026-11-03', now)).toBe('Demain');
    expect(dueLabel('2026-11-06', now)).toBe('Vendredi');
    expect(dueLabel('2026-11-12', now)).toBe('12 nov.');
    expect(dueLabel('2026-11-01', now)).toBe('En retard · hier');
    expect(dueLabel('2026-10-29', now)).toBe('En retard · jeu.');
    expect(dueLabel('2026-10-12', now)).toBe('En retard · 12 oct.');
  });

  it('répétitions', () => {
    expect(repeatLabel({ every: 1, unit: 'week' })).toBe('chaque semaine');
    expect(repeatLabel({ every: 3, unit: 'day' })).toBe('tous les 3 jours');
    expect(repeatLabel({ every: 2, unit: 'week' })).toBe('toutes les 2 semaines');
  });

  it('ligne sous la tâche : échéance, répétition, ou qui l’a faite', () => {
    expect(taskMeta(task({ due: '2026-11-03', repeat: { every: 1, unit: 'week' } }), now, nameOf)).toBe(
      'Demain · chaque semaine ↻',
    );
    expect(taskMeta(task(), now, nameOf)).toBe('Sans date');
    const done = task({ done: true, doneAt: new Date(2026, 10, 2, 7, 40).toISOString(), doneBy: { ownerId: 'lea', via: 'phone' } });
    expect(taskMeta(done, now, nameOf)).toBe('Fait à 07:40 par Léa');
    expect(isLate(task({ due: '2026-11-01' }), now)).toBe(true);
    expect(isLate(task({ due: '2026-11-02' }), now)).toBe(false);
  });

  it('texte partagé : titre, texte et lien sans doublon', () => {
    expect(sharedText(new URLSearchParams({ text: 'Réserver le dentiste' }))).toBe('Réserver le dentiste');
    expect(sharedText(new URLSearchParams({ title: 'Recette', text: 'Recette', url: 'https://x.fr/r' }))).toBe(
      'Recette https://x.fr/r',
    );
  });
});
