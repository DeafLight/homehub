// Page « Routines » : modifier les étapes d'un membre (jours, ordre) et les heures, avant de tout enregistrer.
import type { RoutinePeriod, RoutinePlan, RoutineSettings, RoutineStepPlan } from '../../../shared/types.ts';

/** Jours dans l'ordre de la semaine française (`day` : `Date.getDay()`, 0 : dimanche). */
export const WEEK = [
  { day: 1, short: 'L', name: 'lundi' },
  { day: 2, short: 'M', name: 'mardi' },
  { day: 3, short: 'M', name: 'mercredi' },
  { day: 4, short: 'J', name: 'jeudi' },
  { day: 5, short: 'V', name: 'vendredi' },
  { day: 6, short: 'S', name: 'samedi' },
  { day: 0, short: 'D', name: 'dimanche' },
] as const;

export const MAX_STEPS = 12;
export const PERIODS: RoutinePeriod[] = ['morning', 'evening'];

export const hasDay = (step: Pick<RoutineStepPlan, 'days'>, day: number) => !step.days || step.days.includes(day);

/** Allume ou éteint un jour ; le dernier jour allumé reste allumé. Tous allumés : `days` null (tous les jours). */
export function toggleDay(step: RoutineStepPlan, day: number): RoutineStepPlan {
  const days = new Set(step.days ?? [0, 1, 2, 3, 4, 5, 6]);
  if (days.has(day)) {
    if (days.size === 1) return step;
    days.delete(day);
  } else days.add(day);
  return { ...step, days: days.size === 7 ? null : [...days].sort() };
}

/** Déplace l'étape `index` d'un cran (`delta` : -1 vers le haut, 1 vers le bas). */
export function moveStep<T>(steps: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Identifiant d'une nouvelle étape, distinct des autres (il sert de clé aux cases cochées). */
export function newStepId(existing: Pick<RoutineStepPlan, 'id'>[], random = Math.random): string {
  for (;;) {
    const id = `s-${random().toString(36).slice(2, 10)}`;
    if (!existing.some((s) => s.id === id)) return id;
  }
}

/** Nombre d'étapes prévues le jour de `date`, matin et soir. */
export const stepsOnDay = (plan: RoutinePlan, date: Date) => ({
  morning: plan.morning.filter((s) => hasDay(s, date.getDay())).length,
  evening: plan.evening.filter((s) => hasDay(s, date.getDay())).length,
});

/** Ce qui ne va pas avant d'enregistrer (null : rien), pour le dire tout de suite. */
export function draftProblem(settings: RoutineSettings, nameOf: (ownerId: string) => string): string | null {
  for (const [ownerId, plan] of Object.entries(settings.members)) {
    for (const period of PERIODS) {
      const labels = plan[period].map((s) => s.label.trim().toLowerCase());
      if (labels.includes('')) return `${nameOf(ownerId)} : une étape n'a pas de nom`;
      const twice = labels.find((label, i) => labels.indexOf(label) !== i);
      if (twice) return `${nameOf(ownerId)} : « ${plan[period].find((s) => s.label.trim().toLowerCase() === twice)?.label.trim()} » est en double`;
    }
  }
  const { windows } = settings;
  const ranges = [
    ['matin', windows.morning],
    ['soir', windows.evening],
    ['matin du week-end', windows.weekend?.morning],
    ['soir du week-end', windows.weekend?.evening],
  ] as const;
  for (const [name, range] of ranges) {
    if (range && !(range.from < range.to)) return `Heures du ${name} : le début doit précéder la fin`;
  }
  return null;
}

/** Réglages à envoyer : libellés sans espaces autour, sans la source. */
export const toInput = (settings: RoutineSettings) => ({
  windows: settings.windows,
  members: Object.fromEntries(
    Object.entries(settings.members).map(([id, plan]) => [
      id,
      Object.fromEntries(PERIODS.map((p) => [p, plan[p].map((s) => ({ ...s, label: s.label.trim() }))])) as RoutinePlan,
    ]),
  ),
});
