import { describe, expect, it } from 'vitest';
import { emptyFitness, type FitnessSession, type FitnessState, planSession, type SessionNumber } from './fitness.ts';
import { CHART_WEEKS, fitnessStats, loggedSeconds, shiftWeek } from './fitness-stats.ts';

// Jeudi 5 novembre 2026, 19 h.
const NOW = new Date(2026, 10, 5, 19);

function session(day: Date, n: SessionNumber, extra: Partial<FitnessSession> = {}, notes: Partial<FitnessSession['exercises'][number]> = {}): FitnessSession {
  return {
    id: day.toISOString(),
    at: day.toISOString(),
    session: n,
    palier: 1,
    effort: 30,
    rest: 30,
    rounds: 3,
    rpe: 3,
    stopped: false,
    note: null,
    exercises: planSession(emptyFitness(), n).map(({ family, exercise }) => ({ family, exercise: exercise.id, rating: null, pain: null, reps: null, note: null, ...notes })),
    ...extra,
  };
}

const day = (offset: number, hour = 18) => new Date(2026, 10, 5 + offset, hour);

function state(sessions: FitnessSession[], weeks: FitnessState['weeks'] = {}): FitnessState {
  return { ...emptyFitness(), sessions, weeks };
}

describe('statistiques du programme', () => {
  it('rien de noté : tout à zéro, douze semaines vides', () => {
    const stats = fitnessStats(emptyFitness(), NOW);
    expect(stats).toMatchObject({ sessions: 0, seconds: 0, streak: 0, bestStreak: 0, bestWeek: null, waist: null, months: [] });
    expect(stats.weeks).toHaveLength(CHART_WEEKS);
    expect(stats.weeks.at(-1)).toMatchObject({ week: '2026-11-02', sessions: 0, effort: null, rpe: null });
  });

  it('temps estimé : tours, rythme, pauses entre les tours et échauffement', () => {
    expect(loggedSeconds({ rounds: 3, effort: 30, rest: 30 })).toBe(3 * 6 * 60 + 2 * 60 + 300);
    const stats = fitnessStats(state([session(day(-1), 1), session(day(0), 2, { stopped: true })]), NOW);
    expect(stats).toMatchObject({ sessions: 2, stopped: 1, seconds: 2 * 1500 });
  });

  it('série : semaines d’affilée à 2 séances ou plus ; la semaine en cours ne la casse pas', () => {
    const sessions = [
      // trois semaines régulières, une semaine creuse, puis deux régulières (la dernière : la semaine d'avant)
      ...[-42, -40, -35, -33, -28, -26].map((d, i) => session(day(d), ((i % 3) + 1) as SessionNumber)),
      session(day(-21), 1),
      ...[-14, -12, -7, -5].map((d, i) => session(day(d), ((i % 3) + 1) as SessionNumber)),
    ];
    const stats = fitnessStats(state(sessions), NOW);
    expect(stats.bestStreak).toBe(3);
    expect(stats.streak).toBe(2);
    // deux séances cette semaine : la série passe à 3
    expect(fitnessStats(state([...sessions, session(day(-2), 1), session(day(0), 2)]), NOW).streak).toBe(3);
  });

  it('semaines du graphique : séances, cardio, effort et palier de la dernière séance, ressenti moyen', () => {
    const stats = fitnessStats(
      state([session(day(-9), 1, { rpe: 2 }), session(day(-2), 2, { rpe: 3, effort: 35, rest: 25 }), session(day(0), 3, { rpe: 4, effort: 35, rest: 25 })], {
        '2026-11-02': { cardio: 40, waist: null },
      }),
      NOW,
    );
    expect(stats.weeks.at(-1)).toMatchObject({ week: '2026-11-02', sessions: 2, cardio: 40, effort: 35, palier: 1, rpe: 3.5 });
    expect(stats.weeks.at(-2)).toMatchObject({ week: '2026-10-26', sessions: 1, effort: 30, rpe: 2 });
    expect(stats.bestWeek).toMatchObject({ week: '2026-11-02', sessions: 2 });
  });

  it('par exercice : fois au programme, répétitions notées, dur, facile et gênes', () => {
    const stats = fitnessStats(
      state([
        session(day(-3), 1, {}, { reps: 10, rating: 'dur', pain: 'genoux' }),
        session(day(-1), 1, {}, { reps: 12, rating: 'facile' }),
        session(day(0), 1, {}, { pain: 'genoux' }),
      ]),
      NOW,
    );
    const squats = stats.exercises.find((e) => e.id === 'squat-chaise');
    expect(squats).toMatchObject({ family: 'jambes', times: 3, hard: 1, easy: 1, pains: [{ spot: 'genoux', count: 2 }] });
    expect(squats?.values.map((v) => v.value)).toEqual([10, 12]);
    expect(stats.exercises[0].family).toBe('cardio');
  });

  it('jours de la semaine, du lundi au dimanche', () => {
    // jeudi 5 et dimanche 1er novembre
    expect(fitnessStats(state([session(day(0), 1), session(day(-4), 2)]), NOW).weekdays).toEqual([0, 0, 0, 1, 0, 0, 1]);
  });

  it('tour de taille : depuis le début, et sur 4 semaines', () => {
    const weeks = Object.fromEntries(
      [94, 93.5, 93.5, 93, 92.4, 92].map((waist, i) => [shiftWeek('2026-11-02', i - 5), { cardio: null, waist }]),
    );
    expect(fitnessStats(state([], weeks), NOW).waist).toEqual({ first: 94, last: 92, total: -2, recent: -1.5, weeks: 6 });
    expect(fitnessStats(state([], { '2026-11-02': { cardio: null, waist: 92 } }), NOW).waist).toBeNull();
  });

  it('historique par mois, du plus récent au plus ancien', () => {
    const stats = fitnessStats(state([session(day(-10), 1), session(day(-1), 2), session(day(0), 3)]), NOW);
    expect(stats.months.map((m) => [m.month, m.sessions.map((s) => s.session)])).toEqual([
      ['2026-11', [3, 2]],
      ['2026-10', [1]],
    ]);
  });

  it('changement d’heure : les semaines restent des lundis', () => {
    expect(shiftWeek('2026-10-26', -1)).toBe('2026-10-19');
    expect(shiftWeek('2026-03-23', 1)).toBe('2026-03-30');
  });
});
