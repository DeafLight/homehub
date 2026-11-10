import { describe, expect, it } from 'vitest';
import { CHAINS, EXERCISES, exerciseById, FAMILIES, GENTLE } from './fitness-catalogue.ts';
import {
  applySlotChange,
  emptyFitness,
  type FitnessSession,
  type FitnessState,
  nextSession,
  pendingReview,
  planSession,
  rhythmChoices,
  type SessionEntry,
  sessionSeconds,
  slotKey,
  slotProposals,
  weekOf,
  weekVerdict,
} from './fitness.ts';

let n = 0;
function session(at: string, partial: Partial<FitnessSession> = {}): FitnessSession {
  const state = emptyFitness();
  const s = partial.session ?? 1;
  return {
    id: `s${n++}`,
    at: new Date(at).toISOString(),
    session: s,
    palier: 1,
    effort: 30,
    rest: 30,
    rounds: 3,
    rpe: 3,
    stopped: false,
    exercises: planSession(state, s).map(({ family, exercise }) => ({ family, exercise: exercise.id, rating: null, pain: null, reps: null, note: null })),
    note: null,
    ...partial,
  };
}
const rate = (s: FitnessSession, family: string, entry: Partial<SessionEntry>): FitnessSession => ({
  ...s,
  exercises: s.exercises.map((e) => (e.family === family ? { ...e, ...entry } : e)),
});

describe('catalogue', () => {
  it('chaque chaîne désigne des exercices de sa famille, et chaque exercice a ses consignes', () => {
    for (const s of [1, 2, 3] as const) {
      for (const family of FAMILIES) {
        for (const id of CHAINS[s][family]) expect(exerciseById(id)?.family, id).toBe(family);
      }
    }
    for (const family of FAMILIES) for (const id of GENTLE[family]) expect(exerciseById(id), id).toBeDefined();
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    for (const e of EXERCISES) {
      expect(e.primary.length && e.errors.length && e.start && e.move && e.breath, e.id).toBeTruthy();
    }
  });
});

describe('séances', () => {
  it('tournent 1, 2, 3 sans jour fixe', () => {
    const state = emptyFitness();
    expect(nextSession(state)).toBe(1);
    state.sessions.push(session('2026-11-10T18:00', { session: 1 }));
    expect(nextSession(state)).toBe(2);
    state.sessions.push(session('2026-11-11T18:00', { session: 3 }));
    expect(nextSession(state)).toBe(1);
  });

  it('durée : tours × 6 exercices × (effort + repos) + 1 min entre les tours', () => {
    expect(sessionSeconds({ palier: 1, effort: 30, rest: 30 })).toBe(3 * 6 * 60 + 2 * 60);
    expect(sessionSeconds({ palier: 2, effort: 40, rest: 20 })).toBe(4 * 6 * 60 + 3 * 60);
  });

  it('lundi de la semaine', () => {
    expect(weekOf(new Date(2026, 10, 10, 12))).toBe('2026-11-09'); // mardi
    expect(weekOf(new Date(2026, 10, 15, 23))).toBe('2026-11-09'); // dimanche
    expect(weekOf(new Date(2026, 10, 16, 1))).toBe('2026-11-16'); // lundi
  });
});

describe('bilan de la semaine', () => {
  it('monte après 3 séances sans 4 ni 5, descend après deux 5 ou un arrêt, sinon garde', () => {
    const at = '2026-11-10T18:00';
    expect(weekVerdict([session(at, { rpe: 2 }), session(at, { rpe: 3 }), session(at, { rpe: 1 })])).toBe('up');
    expect(weekVerdict([session(at, { rpe: 2 }), session(at, { rpe: 4 }), session(at, { rpe: 1 })])).toBe('keep');
    expect(weekVerdict([session(at, { rpe: 2 }), session(at, { rpe: 3 })])).toBe('keep');
    expect(weekVerdict([session(at, { rpe: 5 }), session(at, { rpe: 5 })])).toBe('down');
    expect(weekVerdict([session(at, { rpe: 2, stopped: true })])).toBe('down');
  });

  it('propose +5 s à même durée ou plus longue, et garde toujours le choix de ne rien changer', () => {
    const choices = rhythmChoices({ palier: 1, effort: 30, rest: 30 }, 'up');
    expect(choices.map((c) => [c.option, c.rhythm.effort, c.rhythm.rest])).toEqual([
      ['up-same', 35, 25],
      ['up-longer', 35, 30],
      ['keep', 30, 30],
    ]);
    expect(choices[0].seconds).toBe(choices[2].seconds);
    expect(choices[1].seconds).toBeGreaterThan(choices[2].seconds);
  });

  it('descend de 5 s, repos rallongé ou séance plus courte ; respecte les bornes', () => {
    expect(rhythmChoices({ palier: 1, effort: 30, rest: 30 }, 'down').map((c) => c.option)).toEqual(['down-same', 'down-shorter', 'keep']);
    expect(rhythmChoices({ palier: 1, effort: 30, rest: 40 }, 'down').map((c) => c.option)).toEqual(['down-shorter', 'keep']);
    expect(rhythmChoices({ palier: 1, effort: 20, rest: 30 }, 'down').map((c) => c.option)).toEqual(['keep']);
    expect(rhythmChoices({ palier: 1, effort: 40, rest: 10 }, 'up').map((c) => c.option)).toEqual(['up-longer', 'keep']);
    expect(rhythmChoices({ palier: 3, effort: 60, rest: 10 }, 'up').map((c) => c.option)).toEqual(['keep']);
  });

  it('à 45 s d’effort, une bonne semaine propose d’abord le palier suivant, 10 s d’effort en moins', () => {
    const [first] = rhythmChoices({ palier: 1, effort: 45, rest: 15 }, 'up');
    expect(first).toMatchObject({ option: 'next-palier', rhythm: { palier: 2, effort: 35, rest: 15 } });
  });

  it('se tranche une fois la semaine finie, ou dès sa 3e séance', () => {
    const state = emptyFitness();
    state.sessions.push(session('2026-11-09T18:00', { rpe: 2 }), session('2026-11-11T18:00', { rpe: 2, session: 2 }));
    expect(pendingReview(state, new Date('2026-11-12T12:00'))).toBeNull();
    state.sessions.push(session('2026-11-12T18:00', { rpe: 3, session: 3 }));
    expect(pendingReview(state, new Date('2026-11-12T19:00'))).toMatchObject({ week: '2026-11-09', verdict: 'up', sessions: 3 });
    state.reviews['2026-11-09'] = { at: '', choice: 'keep', from: { palier: 1, effort: 30, rest: 30 } };
    expect(pendingReview(state, new Date('2026-11-12T19:00'))).toBeNull();
  });

  it('une semaine finie avec une séance arrêtée propose de baisser', () => {
    const state = emptyFitness();
    state.sessions.push(session('2026-11-10T18:00', { stopped: true }));
    expect(pendingReview(state, new Date('2026-11-10T19:00'))).toBeNull();
    expect(pendingReview(state, new Date('2026-11-17T08:00'))?.verdict).toBe('down');
  });
});

describe('adaptations d’un exercice', () => {
  it('« dur » deux fois : version plus facile proposée ; acceptée, elle suit le palier', () => {
    const state: FitnessState = emptyFitness();
    state.palier = 2;
    state.sessions.push(
      rate(session('2026-11-02T18:00', { session: 1 }), 'poussee', { exercise: 'pompes-inclinees', rating: 'dur' }),
      rate(session('2026-11-09T18:00', { session: 1 }), 'poussee', { exercise: 'pompes-inclinees', rating: 'dur' }),
    );
    const [proposal] = slotProposals(state);
    expect(proposal).toMatchObject({ session: 1, family: 'poussee', change: 'easier', to: { id: 'pompes-mur' } });
    state.slots[slotKey(1, 'poussee')] = applySlotChange(state, 1, 'poussee', 'easier', '2026-11-09T19:00:00.000Z');
    expect(planSession(state, 1).find((p) => p.family === 'poussee')?.exercise.id).toBe('pompes-mur');
    expect(slotProposals(state)).toEqual([]);
    state.palier = 3;
    expect(planSession(state, 1).find((p) => p.family === 'poussee')?.exercise.id).toBe('pompes-inclinees');
  });

  it('une gêne propose le remplaçant doux ; « facile » deux fois dessus ramène à l’exercice normal', () => {
    const state = emptyFitness();
    state.sessions.push(rate(session('2026-11-09T18:00', { session: 1 }), 'jambes', { pain: 'genoux', rating: 'dur' }));
    const [proposal] = slotProposals(state);
    expect(proposal).toMatchObject({ change: 'gentle', from: { id: 'squat-chaise' }, to: { id: 'pont-fessier' } });
    state.slots[slotKey(1, 'jambes')] = applySlotChange(state, 1, 'jambes', 'gentle', '2026-11-09T19:00:00.000Z');
    const planned = planSession(state, 1).find((p) => p.family === 'jambes');
    expect(planned?.exercise.id).toBe('pont-fessier');
    expect(planned?.normal?.id).toBe('squat-chaise');
    state.sessions.push(
      rate(session('2026-11-11T18:00', { session: 1 }), 'jambes', { exercise: 'pont-fessier', rating: 'facile' }),
      rate(session('2026-11-13T18:00', { session: 1 }), 'jambes', { exercise: 'pont-fessier', rating: 'facile' }),
    );
    expect(slotProposals(state)).toMatchObject([{ change: 'normal', to: { id: 'squat-chaise' } }]);
  });

  it('pas de version plus facile que la première de la chaîne', () => {
    const state = emptyFitness();
    state.sessions.push(
      rate(session('2026-11-02T18:00', { session: 1 }), 'poussee', { rating: 'dur' }),
      rate(session('2026-11-09T18:00', { session: 1 }), 'poussee', { rating: 'dur' }),
    );
    expect(slotProposals(state)).toEqual([]);
  });
});
