import { describe, expect, it } from 'vitest';
import { BAND_CHAIN, CHAINS, EXERCISES, exerciseById, FAMILIES, GENTLE, WITHOUT_JUMPS } from './fitness-catalogue.ts';
import {
  applyRhythm,
  applySlotChange,
  chainOf,
  familyList,
  palierHint,
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
  slotTarget,
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

  it('les exercices qui sautent sont marqués, et chacun a sa version sans impact dans sa famille', () => {
    const jumping = EXERCISES.filter((e) => e.impact).map((e) => e.id);
    expect(jumping).toEqual(expect.arrayContaining(['burpees', 'squats-sautes', 'fentes-sautees', 'patineurs-sautes', 'jumping-jacks']));
    expect(Object.keys(WITHOUT_JUMPS).sort()).toEqual([...jumping].sort());
    for (const [from, to] of Object.entries(WITHOUT_JUMPS)) {
      const calm = exerciseById(to);
      expect(calm?.impact, to).toBeUndefined();
      expect(calm?.family, to).toBe(exerciseById(from)?.family);
    }
    // Ni l'échauffement, ni les remplaçants doux ne sautent.
    for (const family of FAMILIES) for (const id of GENTLE[family]) expect(exerciseById(id)?.impact, id).toBeUndefined();
  });

  it('élastique : trois rowings du dos, du plus facile au plus dur, avec le matériel indiqué', () => {
    expect(BAND_CHAIN.map((id) => exerciseById(id))).toEqual(BAND_CHAIN.map(() => expect.objectContaining({ family: 'dos', equipment: 'elastique' })));
    expect(EXERCISES.filter((e) => e.equipment).map((e) => e.id).sort()).toEqual([...BAND_CHAIN].sort());
  });
});

describe('réglages du programme', () => {
  it('sans réglage, les chaînes du catalogue', () => {
    expect(chainOf({ band: false, noJump: false }, 1, 'cardio')).toEqual(CHAINS[1].cardio);
    expect(chainOf({ band: false, noJump: false }, 2, 'dos')).toEqual(CHAINS[2].dos);
  });

  it('élastique : le dos de chaque séance devient un rowing à l’élastique, le reste ne change pas', () => {
    const state = emptyFitness();
    state.settings.band = true;
    for (const s of [1, 2, 3] as const) {
      const plan = planSession(state, s);
      expect(plan.find((p) => p.family === 'dos')).toMatchObject({ exercise: { id: 'rowing-elastique' }, normal: null });
      expect(plan.filter((p) => p.family !== 'dos').map((p) => p.exercise.id)).toEqual(planSession(emptyFitness(), s).filter((p) => p.family !== 'dos').map((p) => p.exercise.id));
    }
    state.palier = 3;
    expect(planSession(state, 2).find((p) => p.family === 'dos')?.exercise).toMatchObject({ id: 'rowing-elastique-un-bras', sides: true });
    expect(sessionSeconds(state)).toBe(sessionSeconds({ palier: 3, effort: 30, rest: 30 })); // même durée : 6 exercices
  });

  it('sans sauts : la version sans impact dès le départ, signalée « à la place de »', () => {
    const state = emptyFitness();
    state.settings.noJump = true;
    expect(planSession(state, 1).find((p) => p.family === 'cardio')).toMatchObject({ exercise: { id: 'jacks-sans-saut' }, normal: { id: 'jumping-jacks' } });
    state.palier = 3;
    for (const s of [1, 2, 3] as const) for (const p of planSession(state, s)) expect(p.exercise.impact, p.exercise.id).toBeUndefined();
    expect(planSession(state, 2).find((p) => p.family === 'unilateral')?.exercise.id).toBe('squat-une-jambe');
  });

  it('sans sauts : pas de « plus difficile » vers le même exercice', () => {
    const state = emptyFitness();
    state.settings.noJump = true;
    state.palier = 2;
    expect(chainOf(state.settings, 3, 'cardio')).toEqual(['pas-chasses', 'patineurs', 'patineurs']);
    expect(slotTarget(state, 3, 'cardio', 'harder')).toBeNull();
    expect(slotTarget(state, 3, 'cardio', 'easier')?.id).toBe('pas-chasses');
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
  it('monte dès 2 séances sans 4 ni 5, descend après deux 5 ou un arrêt, sinon garde', () => {
    const at = '2026-11-10T18:00';
    expect(weekVerdict([session(at, { rpe: 2 }), session(at, { rpe: 3 }), session(at, { rpe: 1 })])).toBe('up');
    expect(weekVerdict([session(at, { rpe: 2 }), session(at, { rpe: 3 })])).toBe('up');
    expect(weekVerdict([session(at, { rpe: 3 })])).toBe('keep');
    expect(weekVerdict([session(at, { rpe: 2 }), session(at, { rpe: 4 }), session(at, { rpe: 1 })])).toBe('keep');
    expect(weekVerdict([session(at, { rpe: 2 }), session(at, { rpe: 2, stopped: true })])).toBe('down');
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

  it('se tranche une fois la semaine finie (même avec 3 séances), puis plus jamais', () => {
    const state = emptyFitness();
    state.sessions.push(session('2026-11-09T18:00', { rpe: 2 }), session('2026-11-11T18:00', { rpe: 2, session: 2 }));
    expect(pendingReview(state, new Date('2026-11-12T12:00'))).toBeNull();
    state.sessions.push(session('2026-11-12T18:00', { rpe: 3, session: 3 }));
    expect(pendingReview(state, new Date('2026-11-12T19:00'))).toBeNull();
    expect(pendingReview(state, new Date('2026-11-16T08:00'))).toMatchObject({ week: '2026-11-09', verdict: 'up', sessions: 3 });
    state.reviews['2026-11-09'] = { at: '', choice: 'keep', from: { palier: 1, effort: 30, rest: 30 } };
    expect(pendingReview(state, new Date('2026-11-16T08:00'))).toBeNull();
  });

  it('une 3e séance dure dans la semaine compte encore : le bilan attend le lundi', () => {
    const state = emptyFitness();
    state.sessions.push(session('2026-11-09T18:00', { rpe: 2 }), session('2026-11-11T18:00', { rpe: 3, session: 2 }), session('2026-11-14T10:00', { rpe: 5, session: 3 }));
    expect(pendingReview(state, new Date('2026-11-16T08:00'))).toBeNull(); // garde
  });

  it('le bilan de la semaine passée reste proposé après une séance de la nouvelle semaine, pas plus tard', () => {
    const state = emptyFitness();
    state.sessions.push(session('2026-11-09T18:00', { rpe: 2 }), session('2026-11-11T18:00', { rpe: 2, session: 2 }));
    state.sessions.push(session('2026-11-16T18:00', { rpe: 3, session: 3 }));
    expect(pendingReview(state, new Date('2026-11-17T08:00'))?.week).toBe('2026-11-09');
    expect(pendingReview(state, new Date('2026-11-24T08:00'))).toBeNull(); // semaine du 16 : une seule séance, on garde
  });

  it('une semaine finie avec une séance arrêtée propose de baisser', () => {
    const state = emptyFitness();
    state.sessions.push(session('2026-11-10T18:00', { stopped: true }));
    expect(pendingReview(state, new Date('2026-11-10T19:00'))).toBeNull();
    expect(pendingReview(state, new Date('2026-11-17T08:00'))?.verdict).toBe('down');
  });
});

describe('changement de palier en deux temps', () => {
  /** Programme à 45 s d'effort après une bonne semaine : palier 2 choisi. */
  function nextPalier() {
    const state = emptyFitness();
    Object.assign(state, { effort: 45, rest: 15 });
    const choice = rhythmChoices(state, 'up')[0];
    expect(choice.option).toBe('next-palier');
    applyRhythm(state, choice, '2026-11-16T08:00:00.000Z');
    return state;
  }

  it('la moitié des familles passe tout de suite à la version du palier, l’autre garde la version d’avant', () => {
    const state = nextPalier();
    expect(state).toMatchObject({ palier: 2, effort: 35, stage: { moved: ['jambes', 'dos', 'gainage'], waiting: ['cardio', 'poussee', 'unilateral'] } });
    const plan = planSession(state, 1);
    const byFamily = Object.fromEntries(plan.map((p) => [p.family, p]));
    expect(byFamily.jambes).toMatchObject({ exercise: { id: 'squats' }, stage: 'new', before: { id: 'squat-chaise' }, normal: null });
    expect(byFamily.cardio).toMatchObject({ exercise: { id: 'jumping-jacks' }, stage: 'waiting', before: null, normal: null });
    expect(plan.filter((p) => p.stage === 'new')).toHaveLength(3);
    expect(palierHint(state)).toContain('cardio, poussée et une jambe');
  });

  it('« nouveau » jusqu’à ce que la séance ait été faite une fois', () => {
    const state = nextPalier();
    state.sessions.push(session('2026-11-16T18:00', { session: 1, palier: 2 }));
    expect(planSession(state, 1).some((p) => p.stage === 'new')).toBe(false);
    expect(planSession(state, 2).filter((p) => p.stage === 'new')).toHaveLength(3);
  });

  it('au bon bilan suivant, seulement « finir le palier » (ou garder) ; l’autre moitié passe, même rythme', () => {
    const state = nextPalier();
    const choices = rhythmChoices(state, 'up', true);
    expect(choices.map((c) => c.option)).toEqual(['complete-palier', 'keep']);
    expect(choices[0].rhythm).toEqual({ palier: 2, effort: 35, rest: 15 });
    state.sessions.push(session('2026-11-17T18:00', { rpe: 2, palier: 2 }), session('2026-11-19T18:00', { rpe: 2, session: 2, palier: 2 }));
    expect(pendingReview(state, new Date('2026-11-23T08:00'))?.choices.map((c) => c.option)).toEqual(['complete-palier', 'keep']);
    applyRhythm(state, choices[0], '2026-11-23T08:00:00.000Z');
    expect(state.stage).toEqual({ moved: ['cardio', 'poussee', 'unilateral'], waiting: [], since: '2026-11-23T08:00:00.000Z' });
    const plan = planSession(state, 3);
    expect(plan.find((p) => p.family === 'cardio')).toMatchObject({ exercise: { id: 'patineurs' }, stage: 'new', before: { id: 'pas-chasses' } });
    expect(plan.find((p) => p.family === 'jambes')?.stage).toBeNull();
    // Plus rien en attente : la suite reprend comme avant.
    expect(rhythmChoices({ palier: 2, effort: 30, rest: 30 }, 'up', false)[0].option).toBe('up-same');
  });

  it('un exercice décalé pendant l’attente garde son décalage quand sa famille passe', () => {
    const state = nextPalier();
    state.slots[slotKey(1, 'poussee')] = applySlotChange(state, 1, 'poussee', 'harder', '2026-11-16T09:00:00.000Z');
    expect(planSession(state, 1).find((p) => p.family === 'poussee')?.exercise.id).toBe('pompes-inclinees');
    applyRhythm(state, rhythmChoices(state, 'up', true)[0], '2026-11-23T08:00:00.000Z');
    expect(planSession(state, 1).find((p) => p.family === 'poussee')?.exercise.id).toBe('pompes');
  });

  it('familles en toutes lettres', () => {
    expect(familyList(['jambes', 'dos', 'gainage'])).toBe('jambes, dos et gainage');
    expect(familyList(['unilateral'])).toBe('une jambe');
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
