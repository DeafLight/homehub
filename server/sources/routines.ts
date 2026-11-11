// Routines du matin et du soir des membres (étapes : routine-plans.ts) : ce qui a été coché, jour par jour, est
// enregistré dans le dossier d'état (routines.json) ; la liste repart de zéro chaque jour. Les jours anciens sont
// oubliés au bout de ROUTINE_DAYS_KEPT jours, assez pour compter les jours de suite.
import { z } from 'zod';
import { localDay, localTime } from '../../shared/dates.ts';
import type { Author, RoutinePeriod, RoutineWindows } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema } from './schemas.ts';
import type { Clock } from './types.ts';

const ROUTINE_DAYS_KEPT = 60;

const fileSchema = z.object({
  version: z.literal(1),
  /** Jour local AAAA-MM-JJ → clé d'étape (voir `stepKey`) → qui l'a cochée, et quand. */
  days: z.record(z.string(), z.record(z.string(), z.object({ at: z.string(), by: authorSchema }))),
});

type RoutinesFile = z.infer<typeof fileSchema>;

const isWeekend = (date: Date) => date.getDay() === 0 || date.getDay() === 6;

/** Étape des jours d'école : prévue certains jours de semaine seulement, jamais le week-end (« Cartable », « Devoirs »). */
const schoolDaysOnly = (days: number[]) => days.every((d) => d >= 1 && d <= 5);

/**
 * Étapes prévues le jour de `date` (celles sans jours précisés : tous les jours). Un jour de vacances scolaires
 * (`holiday`), les étapes des jours d'école sont mises de côté.
 */
export const stepsOn = <T extends { days: number[] | null }>(steps: T[], date: Date, holiday = false) =>
  steps.filter((s) => !s.days || (s.days.includes(date.getDay()) && !(holiday && schoolDaysOnly(s.days))));

/**
 * Clé d'une étape : son identifiant stable plutôt que son rang, pour qu'une étape ajoutée ne décale pas les autres
 * (et qu'une étape renommée garde ses cases cochées).
 */
export const stepKey = (ownerId: string, period: RoutinePeriod, stepId: string) => `${ownerId}|${period}|${stepId}`;

/**
 * Routine affichée à cette heure-ci, d'après les plages réglées (heure locale ; le week-end, les siennes, et de même
 * pendant les vacances scolaires : `holiday`).
 */
export function currentPeriod(now: Date, windows: RoutineWindows, holiday = false): RoutinePeriod | null {
  const time = localTime(now);
  for (const period of ['morning', 'evening'] as const) {
    const range = ((isWeekend(now) || holiday) && windows.weekend?.[period]) || windows[period];
    if (range.from <= time && time < range.to) return period;
  }
  return null;
}

export type RoutineStore = {
  /** Étapes cochées le jour `day`, par clé. */
  doneOn(day: string): Promise<Set<string>>;
  setDone(day: string, key: string, done: boolean, by: Author): Promise<void>;
  /**
   * Jours de suite (jusqu'à `today`, sans le compter s'il n'est pas complet) où toutes les étapes prévues ce jour-là
   * (`keysOn`) étaient cochées ; un jour sans étape prévue ne compte pas et ne casse pas la série.
   */
  streak(keysOn: (date: Date) => string[], today: string): Promise<number>;
};

export function createRoutineStore({ path, clock }: { path: string; clock: Clock }): RoutineStore {
  const state = createJsonFile<RoutinesFile>({
    path,
    schema: fileSchema,
    initial: () => ({ version: 1, days: {} }),
    beforeSave(draft) {
      const limit = new Date(clock());
      limit.setDate(limit.getDate() - ROUTINE_DAYS_KEPT);
      const oldest = localDay(limit);
      for (const day of Object.keys(draft.days)) if (day < oldest) delete draft.days[day];
    },
  });

  return {
    async doneOn(day) {
      return new Set(Object.keys((await state.read()).days[day] ?? {}));
    },

    setDone(day, key, done, by) {
      return state.update((file) => {
        const entries = (file.days[day] ??= {});
        if (done) entries[key] ??= { at: clock().toISOString(), by };
        else delete entries[key];
        if (Object.keys(entries).length === 0) delete file.days[day];
      });
    },

    async streak(keysOn, today) {
      const { days } = await state.read();
      const [y, m, d] = today.split('-').map(Number);
      /** null : rien de prévu ce jour-là. */
      const complete = (offset: number) => {
        const date = new Date(y, m - 1, d - offset);
        const keys = keysOn(date);
        return keys.length === 0 ? null : keys.every((key) => key in (days[localDay(date)] ?? {}));
      };
      let count = 0;
      // Aujourd'hui compte s'il est déjà complet ; sinon, la série d'hier tient encore.
      for (let offset = complete(0) ? 0 : 1; offset <= ROUTINE_DAYS_KEPT; offset++) {
        const result = complete(offset);
        if (result === false) break;
        if (result) count++;
      }
      return count;
    },
  };
}
