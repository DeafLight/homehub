// Tests du filtre « Pour qui » des tâches : boutons affichés et filtre à l'ouverture.
import { describe, expect, it } from 'vitest';
import type { ListTask } from '../../../shared/types.ts';
import { filterChips, initialTaskFilter, openTaskCount } from './task-filter.ts';

const family = ['alex', 'sam', 'lea', 'tom'];

const task = (id: string, ownerId: string, done = false): ListTask => ({
  id,
  label: 'Poubelles',
  ownerId,
  due: null,
  repeat: null,
  done,
  addedBy: { ownerId: 'sam', via: 'phone' },
  addedAt: '2026-11-02T17:00:00.000Z',
});

const tasks = [task('1', 'tom'), task('2', 'sam', true), task('3', 'tom', true)];

describe('openTaskCount', () => {
  it('compte les tâches à faire, de tout le monde ou d’une personne', () => {
    expect(openTaskCount(tasks, null)).toBe(1);
    expect(openTaskCount(tasks, 'tom')).toBe(1);
    expect(openTaskCount(tasks, 'sam')).toBe(0);
    expect(openTaskCount(tasks, 'lea')).toBe(0);
  });
});

describe('filterChips', () => {
  it('montre les personnes qui ont une tâche, même faite, dans l’ordre des profils', () => {
    expect(filterChips(family, tasks, null)).toEqual(['sam', 'tom']);
  });

  it('téléphone : la personne du téléphone garde son bouton sans tâche, même sur « Tous »', () => {
    expect(filterChips(family, tasks, 'lea', ['lea'])).toEqual(['sam', 'lea', 'tom']);
    expect(filterChips(family, tasks, null, ['lea'])).toEqual(['sam', 'lea', 'tom']);
    expect(filterChips(family, [], null, ['lea'])).toEqual(['lea']);
  });

  it('garde le filtre en cours sur une personne qui n’a plus de tâche, puis le retire après « Tous »', () => {
    expect(filterChips(family, tasks, 'alex')).toEqual(['alex', 'sam', 'tom']);
    expect(filterChips(family, tasks, null)).toEqual(['sam', 'tom']);
  });

  it('tablette : le profil d’origine reste épinglé, les autres sans tâche restent cachés', () => {
    expect(filterChips(family, tasks, null, ['alex'])).toEqual(['alex', 'sam', 'tom']);
  });

  it('tablette « Famille » : rien d’épinglé', () => {
    expect(filterChips(family, [], null, [])).toEqual([]);
  });
});

describe('initialTaskFilter', () => {
  it('ouvre sur la personne quand elle a une tâche à faire', () => {
    expect(initialTaskFilter(tasks, 'tom')).toBe('tom');
  });

  it('ouvre sur « Tous » quand la personne n’a rien à faire (aucune tâche, ou toutes faites)', () => {
    expect(initialTaskFilter(tasks, 'lea')).toBeNull();
    expect(initialTaskFilter(tasks, 'sam')).toBeNull();
    expect(initialTaskFilter([], 'lea')).toBeNull();
  });

  it('ouvre sur « Tous » sans personne', () => {
    expect(initialTaskFilter(tasks, null)).toBeNull();
  });
});
