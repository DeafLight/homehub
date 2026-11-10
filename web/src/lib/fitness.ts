// Affichage du programme de renforcement (onglet Sport) : durées, place d'un exercice dans le programme, historique.
import { BAND_CHAIN, CHAINS, type Exercise, exerciseById, type FitnessFamily, GENTLE, WITHOUT_JUMPS } from '../../../shared/fitness-catalogue.ts';
import type { FitnessState, SessionNumber, WeekLog } from '../../../shared/fitness.ts';

/** « 20 min », « 22 min 30 ». */
export function formatMinutes(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec ? `${min} min ${String(sec).padStart(2, '0')}` : `${min} min`;
}

export type Placement = { session: SessionNumber; palier: 1 | 2 | 3 };

export type ExercisePlacement = {
  /** Séances et paliers où il est au programme, sans réglage. */
  places: Placement[];
  /** Palier où il est au programme dans toutes les séances avec un élastique de tirage. */
  band: 1 | 2 | 3 | null;
  /** Exercices qui sautent qu'il remplace avec le réglage « sans sauts ». */
  replaces: Exercise[];
  /** Sa version sans saut, s'il saute. */
  withoutJumps: Exercise | null;
  easier: Exercise | null;
  harder: Exercise | null;
  gentle: Exercise | null;
};

/** Où l'exercice apparaît dans le programme (séance, palier, réglages), et ses versions voisines. */
export function placementOf(exercise: Exercise): ExercisePlacement {
  const places: Placement[] = [];
  let easier: Exercise | null = null;
  let harder: Exercise | null = null;
  const neighbours = (chain: readonly string[], index: number) => {
    easier ??= index > 0 ? exerciseById(chain[index - 1])! : null;
    harder ??= index < 2 ? exerciseById(chain[index + 1])! : null;
  };
  for (const session of [1, 2, 3] as SessionNumber[]) {
    const chain = CHAINS[session][exercise.family];
    const index = chain.indexOf(exercise.id);
    if (index < 0) continue;
    places.push({ session, palier: (index + 1) as 1 | 2 | 3 });
    neighbours(chain, index);
  }
  const bandIndex = BAND_CHAIN.indexOf(exercise.id);
  if (bandIndex >= 0) neighbours(BAND_CHAIN, bandIndex);
  const gentleId = GENTLE[exercise.family].find((id) => id !== exercise.id);
  const replaces = Object.entries(WITHOUT_JUMPS)
    .filter(([, to]) => to === exercise.id)
    .map(([from]) => exerciseById(from)!);
  return {
    places,
    band: bandIndex >= 0 ? ((bandIndex + 1) as 1 | 2 | 3) : null,
    replaces,
    withoutJumps: exercise.impact ? (exerciseById(WITHOUT_JUMPS[exercise.id]) ?? null) : null,
    easier,
    harder,
    gentle: gentleId ? exerciseById(gentleId)! : null,
  };
}

/**
 * Exercices d'une famille, dans l'ordre du programme (séance, puis palier), puis ceux de l'élastique, les versions
 * sans saut et les remplaçants doux qui ne sont pas déjà dans la liste.
 */
export function familyExercises(family: FitnessFamily): Exercise[] {
  const ids = new Set<string>();
  for (const session of [1, 2, 3] as SessionNumber[]) for (const id of CHAINS[session][family]) ids.add(id);
  if (family === 'dos') for (const id of BAND_CHAIN) ids.add(id);
  for (const id of Object.values(WITHOUT_JUMPS)) ids.add(id);
  for (const id of GENTLE[family]) ids.add(id);
  return [...ids].map((id) => exerciseById(id)!).filter((e) => e.family === family);
}

/** Tours de taille notés, du plus ancien au plus récent. */
export const waistSeries = (state: FitnessState) =>
  Object.entries(state.weeks)
    .filter(([, log]) => log.waist !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, log]) => ({ week, waist: log.waist as number }));

/** Points de la courbe du tour de taille (au moins deux), dans un cadre de 300 × 80. */
export function waistPath(points: { waist: number }[]): string {
  const W = 300;
  const H = 80;
  const min = Math.min(...points.map((p) => p.waist));
  const max = Math.max(...points.map((p) => p.waist));
  const span = max - min || 1;
  return points.map((p, i) => `${(i / (points.length - 1)) * (W - 12) + 6},${H - 8 - ((p.waist - min) / span) * (H - 16)}`).join(' ');
}

/**
 * Cardio et tour de taille de la semaine tels qu'on les envoie : un champ vide (ou effacé) vaut null, le cardio en
 * minutes entières. Les champs numériques rendent null, un nombre, ou parfois une chaîne vide.
 */
export function weekLogInput(cardio: unknown, waist: unknown): WeekLog {
  return { cardio: typeof cardio === 'number' ? Math.round(cardio) : null, waist: typeof waist === 'number' ? waist : null };
}

/** Les champs diffèrent-ils de ce qui est enregistré pour la semaine ? */
export function weekLogChanged(saved: WeekLog | undefined, cardio: number | null, waist: number | null): boolean {
  return (saved?.cardio ?? null) !== (cardio ?? null) || (saved?.waist ?? null) !== (waist ?? null);
}
