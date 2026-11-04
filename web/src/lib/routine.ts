// Libellés des routines du matin et du soir (logique pure, testée).
import type { Routine, RoutinePeriod } from '../../../shared/types.ts';

export const routineName = (period: RoutinePeriod) => (period === 'morning' ? 'Routine du matin' : 'Routine du soir');

/** « Routine du soir · 2/5 ». */
export function routineTitle(routine: Pick<Routine, 'period' | 'items'>): string {
  const done = routine.items.filter((i) => i.done).length;
  return `${routineName(routine.period)} · ${done}/${routine.items.length}`;
}

/** Encouragement sous la liste : fini, et jours de suite (à partir de 2). */
export function routineFooter({ items, streak }: Pick<Routine, 'items' | 'streak'>): string | null {
  const finished = items.length > 0 && items.every((i) => i.done);
  const series = streak >= 2 ? `${streak} jours de suite` : null;
  if (finished) return series ? `Bravo, c'est fini ! ${series}` : "Bravo, c'est fini !";
  return series ? `${series} : continue !` : null;
}
