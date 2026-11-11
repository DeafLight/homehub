// Tests du geste annulable (retrait d'un repas du menu) : délai, « Annuler », geste suivant, départ de la page.
import { describe, expect, it } from 'vitest';
import { createUndoable, type Timers } from './undo.ts';

/** Minuteries à la main : `fire()` déclenche celles encore actives. */
function fakeTimers() {
  const active = new Map<number, () => void>();
  let next = 0;
  const timers: Timers = {
    set: (fn) => {
      active.set(++next, fn);
      return next;
    },
    clear: (handle) => active.delete(handle as number),
  };
  const fire = () => [...active.entries()].forEach(([id, fn]) => (active.delete(id), fn()));
  return { timers, fire, count: () => active.size };
}

describe('geste annulable', () => {
  it('fait le geste au bout du délai seulement', () => {
    const { timers, fire } = fakeTimers();
    const done: string[] = [];
    const changes: (string | null)[] = [];
    const undo = createUndoable<string>((id) => done.push(id), (p) => changes.push(p), 5000, timers);
    undo.start('a');
    expect(undo.pending).toBe('a');
    expect(done).toEqual([]);
    fire();
    expect(done).toEqual(['a']);
    expect(undo.pending).toBeNull();
    expect(changes).toEqual(['a', null]);
  });

  it('« Annuler » rend l’élément et rien n’est fait', () => {
    const { timers, fire, count } = fakeTimers();
    const done: string[] = [];
    const undo = createUndoable<string>((id) => done.push(id), undefined, 5000, timers);
    undo.start('a');
    expect(undo.cancel()).toBe('a');
    expect(count()).toBe(0);
    fire();
    expect(done).toEqual([]);
    expect(undo.cancel()).toBeNull();
  });

  it('un deuxième geste fait aussitôt le premier', () => {
    const { timers, fire } = fakeTimers();
    const done: string[] = [];
    const undo = createUndoable<string>((id) => done.push(id), undefined, 5000, timers);
    undo.start('a');
    undo.start('b');
    expect(done).toEqual(['a']);
    expect(undo.pending).toBe('b');
    fire();
    expect(done).toEqual(['a', 'b']);
  });

  it('quitter la page fait le geste en attente, une seule fois', () => {
    const { timers, fire } = fakeTimers();
    const done: string[] = [];
    const undo = createUndoable<string>((id) => done.push(id), undefined, 5000, timers);
    undo.start('a');
    undo.flush();
    undo.flush();
    fire();
    expect(done).toEqual(['a']);
  });
});
