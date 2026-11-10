// Affichage du programme de renforcement (onglet Sport) : durées, place d'un exercice dans le programme, historique.
import { CHAINS, type Exercise, exerciseById, type FitnessFamily, GENTLE } from '../../../shared/fitness-catalogue.ts';
import type { FitnessState, SessionNumber } from '../../../shared/fitness.ts';

/** « 20 min », « 22 min 30 ». */
export function formatMinutes(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec ? `${min} min ${String(sec).padStart(2, '0')}` : `${min} min`;
}

export type Placement = { session: SessionNumber; palier: 1 | 2 | 3 };

/** Où l'exercice apparaît dans le programme (séance, palier), et ses versions voisines. */
export function placementOf(exercise: Exercise): { places: Placement[]; easier: Exercise | null; harder: Exercise | null; gentle: Exercise | null } {
  const places: Placement[] = [];
  let easier: Exercise | null = null;
  let harder: Exercise | null = null;
  for (const session of [1, 2, 3] as SessionNumber[]) {
    const chain = CHAINS[session][exercise.family];
    const index = chain.indexOf(exercise.id);
    if (index < 0) continue;
    places.push({ session, palier: (index + 1) as 1 | 2 | 3 });
    easier ??= index > 0 ? exerciseById(chain[index - 1])! : null;
    harder ??= index < 2 ? exerciseById(chain[index + 1])! : null;
  }
  const gentleId = GENTLE[exercise.family].find((id) => id !== exercise.id);
  return { places, easier, harder, gentle: gentleId ? exerciseById(gentleId)! : null };
}

/** Exercices d'une famille, dans l'ordre du programme (séance, puis palier), suivis des remplaçants doux seuls. */
export function familyExercises(family: FitnessFamily): Exercise[] {
  const ids = new Set<string>();
  for (const session of [1, 2, 3] as SessionNumber[]) for (const id of CHAINS[session][family]) ids.add(id);
  for (const id of GENTLE[family]) ids.add(id);
  return [...ids].map((id) => exerciseById(id)!).filter((e) => e.family === family);
}

/** Tours de taille notés, du plus ancien au plus récent. */
export const waistSeries = (state: FitnessState) =>
  Object.entries(state.weeks)
    .filter(([, log]) => log.waist !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, log]) => ({ week, waist: log.waist as number }));
