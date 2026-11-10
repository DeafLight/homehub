// Statistiques du programme de renforcement (page Statistiques du téléphone), calculées à partir de ce qui est déjà
// noté : séances, rythme, ressentis, répétitions, gênes, cardio et tour de taille de chaque semaine. Rien de nouveau à
// saisir. Données personnelles : seul le téléphone de la personne les affiche.
import { exerciseById, FAMILIES, type FitnessFamily } from './fitness-catalogue.ts';
import { type FitnessSession, type FitnessState, PAIN_SPOTS, type PainSpot, type Palier, ROUND_BREAK_SECONDS, WARMUP_MINUTES, weekOf } from './fitness.ts';

/** Une semaine compte dans la série à partir de ce nombre de séances. */
export const STREAK_SESSIONS = 2;
/** Semaines montrées dans les graphiques de régularité et de progression. */
export const CHART_WEEKS = 12;

export type WeekStat = {
  /** Lundi de la semaine (AAAA-MM-JJ). */
  week: string;
  sessions: number;
  seconds: number;
  cardio: number | null;
  /** Effort (s) de la dernière séance de la semaine, palier compris ; null sans séance. */
  effort: number | null;
  palier: Palier | null;
  /** Ressenti moyen (1 à 5) ; null sans séance. */
  rpe: number | null;
};

export type ExerciseStat = {
  id: string;
  family: FitnessFamily;
  /** Séances où il était au programme. */
  times: number;
  /** Répétitions (ou secondes tenues) par tour, quand elles ont été notées, de la plus ancienne à la plus récente. */
  values: { at: string; value: number }[];
  hard: number;
  easy: number;
  pains: { spot: PainSpot; count: number }[];
};

export type FitnessStats = {
  sessions: number;
  stopped: number;
  /** Temps d'entraînement estimé, échauffement compris (une séance arrêtée compte en entier). */
  seconds: number;
  /** Semaines d'affilée avec au moins STREAK_SESSIONS séances (la semaine en cours compte dès qu'elle les a). */
  streak: number;
  bestStreak: number;
  bestWeek: WeekStat | null;
  /** Les CHART_WEEKS dernières semaines, de la plus ancienne à la semaine en cours. */
  weeks: WeekStat[];
  exercises: ExerciseStat[];
  /** Séances par jour de la semaine, du lundi au dimanche. */
  weekdays: number[];
  waist: { first: number; last: number; total: number; recent: number | null; weeks: number } | null;
  /** Toutes les séances par mois, du plus récent au plus ancien. */
  months: { month: string; sessions: FitnessSession[] }[];
};

/** Durée estimée d'une séance notée : tours, rythme, pauses entre les tours et échauffement. */
export const loggedSeconds = (s: Pick<FitnessSession, 'rounds' | 'effort' | 'rest'>) =>
  s.rounds * FAMILIES.length * (s.effort + s.rest) + (s.rounds - 1) * ROUND_BREAK_SECONDS + WARMUP_MINUTES * 60;

/** Lundi décalé de `weeks` semaines (midi, pour ne pas glisser au changement d'heure). */
export function shiftWeek(week: string, weeks: number): string {
  const d = new Date(`${week}T12:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  return weekOf(d);
}

export function fitnessStats(state: FitnessState, now: Date): FitnessStats {
  const sessions = [...state.sessions].sort((a, b) => a.at.localeCompare(b.at));
  const current = weekOf(now);

  // Séances regroupées par semaine.
  const byWeek = new Map<string, FitnessSession[]>();
  for (const s of sessions) {
    const week = weekOf(new Date(s.at));
    byWeek.set(week, [...(byWeek.get(week) ?? []), s]);
  }
  const weekStat = (week: string): WeekStat => {
    const list = byWeek.get(week) ?? [];
    const last = list.at(-1);
    return {
      week,
      sessions: list.length,
      seconds: list.reduce((sum, s) => sum + loggedSeconds(s), 0),
      cardio: state.weeks[week]?.cardio ?? null,
      effort: last?.effort ?? null,
      palier: last?.palier ?? null,
      rpe: list.length ? Math.round((list.reduce((sum, s) => sum + s.rpe, 0) / list.length) * 10) / 10 : null,
    };
  };

  // Séries de semaines régulières, de la première séance à la semaine en cours.
  let streak = 0;
  let bestStreak = 0;
  let run = 0;
  const first = sessions[0] ? weekOf(new Date(sessions[0].at)) : current;
  for (let week = first; week <= current; week = shiftWeek(week, 1)) {
    const ok = (byWeek.get(week)?.length ?? 0) >= STREAK_SESSIONS;
    if (ok) run++;
    else if (week !== current) run = 0; // la semaine en cours n'est pas finie : elle ne casse pas la série
    bestStreak = Math.max(bestStreak, run);
  }
  if (sessions.length) streak = run;

  const all = [...byWeek.keys()].map(weekStat);
  const bestWeek = all.reduce<WeekStat | null>((best, w) => (!best || w.sessions > best.sessions || (w.sessions === best.sessions && w.seconds > best.seconds) ? w : best), null);
  const weeks = Array.from({ length: CHART_WEEKS }, (_, i) => weekStat(shiftWeek(current, i - CHART_WEEKS + 1)));

  // Par exercice.
  const byExercise = new Map<string, ExerciseStat>();
  for (const s of sessions) {
    for (const e of s.exercises) {
      const stat = byExercise.get(e.exercise) ?? { id: e.exercise, family: e.family, times: 0, values: [], hard: 0, easy: 0, pains: [] };
      stat.times++;
      if (e.reps !== null) stat.values.push({ at: s.at, value: e.reps });
      if (e.rating === 'dur') stat.hard++;
      if (e.rating === 'facile') stat.easy++;
      if (e.pain) {
        const pain = stat.pains.find((p) => p.spot === e.pain);
        if (pain) pain.count++;
        else stat.pains.push({ spot: e.pain, count: 1 });
      }
      byExercise.set(e.exercise, stat);
    }
  }
  const exercises = [...byExercise.values()]
    .filter((e) => exerciseById(e.id))
    .map((e) => ({ ...e, pains: e.pains.sort((a, b) => PAIN_SPOTS.indexOf(a.spot) - PAIN_SPOTS.indexOf(b.spot)) }))
    .sort((a, b) => FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family) || b.times - a.times);

  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sessions) weekdays[(new Date(s.at).getDay() + 6) % 7]++;

  // Tour de taille : depuis le début, et sur les 4 dernières semaines notées.
  const waists = Object.entries(state.weeks)
    .filter(([, log]) => log.waist !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, log]) => ({ week, waist: log.waist as number }));
  const lastWaist = waists.at(-1);
  const fourWeeksBefore = lastWaist ? [...waists].reverse().find((w) => w.week <= shiftWeek(lastWaist.week, -4)) : undefined;
  const round = (n: number) => Math.round(n * 10) / 10;
  const waist =
    waists.length >= 2 && lastWaist
      ? {
          first: waists[0].waist,
          last: lastWaist.waist,
          total: round(lastWaist.waist - waists[0].waist),
          recent: fourWeeksBefore ? round(lastWaist.waist - fourWeeksBefore.waist) : null,
          weeks: waists.length,
        }
      : null;

  const months: FitnessStats['months'] = [];
  for (const s of [...sessions].reverse()) {
    const d = new Date(s.at);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (months.at(-1)?.month === month) months.at(-1)!.sessions.push(s);
    else months.push({ month, sessions: [s] });
  }

  return {
    sessions: sessions.length,
    stopped: sessions.filter((s) => s.stopped).length,
    seconds: sessions.reduce((sum, s) => sum + loggedSeconds(s), 0),
    streak,
    bestStreak,
    bestWeek,
    weeks,
    exercises,
    weekdays,
    waist,
    months,
  };
}
