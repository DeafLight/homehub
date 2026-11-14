// Mode cuisine d'une recette sur la télé (fonction 13 de l'appli HomeHub TV, docs/appli-tele.md) : ce que la télé
// affiche (l'étape en cours en grand, ses minuteurs, ceux de la maison qui tournent) et comment il se calcule à partir
// de la recette et des minuteurs. Même logique que le mode cuisine de la tablette (durées citées par l'étape, mode
// Cookeo, nom du minuteur d'une étape) ; les minuteurs restent ceux de HomeHub, une seule source. Commun au serveur,
// au front (pilotage depuis la fiche recette) et, recopié en Kotlin, à l'appli (tv-app, Cuisine.kt).
import { cookeoMode, durationText, type Recipe, stepDurations, timerLabel } from './recipes.ts';
import type { Timer } from './types.ts';

/** Une durée citée par l'étape : le bouton « Lancer 10 min », et le minuteur déjà lancé pour elle s'il tourne. */
export type ScreenCookDuration = { seconds: number; text: string; timerId: string | null };

export type ScreenCookStep = {
  /** Numéro de l'étape, à partir de 1. */
  number: number;
  text: string;
  section: string | null;
  /** Mode Cookeo de l'étape, pour une recette Cookeo. */
  mode: string | null;
  durations: ScreenCookDuration[];
};

/**
 * Un minuteur de la maison vu de la télé : le temps qui reste au moment de la réponse (la télé décompte elle-même, sans
 * dépendre de son horloge) ; `step` : l'étape de cette recette qui l'a lancé, sinon null (autre minuteur de la maison).
 */
export type ScreenCookTimer = { id: string; label: string; durationSeconds: number; remainingSeconds: number; ended: boolean; step: number | null };

/** Le mode cuisine d'une télé, tel qu'elle l'affiche ; `rev` change à chaque changement d'étape ou de recette. */
export type ScreenCook = {
  rev: number;
  recipeId: string;
  title: string;
  /** Étape en cours, à partir de 0, et nombre d'étapes. */
  index: number;
  total: number;
  /** null : recette sans étapes. */
  step: ScreenCookStep | null;
  /** Début de l'étape suivante (« Ensuite : … »), null à la dernière. */
  next: string | null;
  timers: ScreenCookTimer[];
};

/** Mode cuisine en cours sur une télé : la recette et l'étape ; `rev` augmente à chaque changement. */
export type ScreenCookSession = { recipeId: string; index: number; rev: number };

/** Une télé où lancer le mode cuisine, vue de la fiche recette (tablette, téléphone) ; `cook` : son mode cuisine en cours. */
export type ScreenCookTarget = { id: string; name: string; online: boolean; cook: ScreenCook | null };

/** Longueur au plus du début de l'étape suivante. */
export const NEXT_STEP_MAX = 90;

/** Début d'un texte coupé au mot, avec « … » s'il est plus long que `max`. */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Étape à afficher : `index` ramené entre la première et la dernière. */
export const clampStep = (index: number, total: number) => Math.max(0, Math.min(Math.trunc(index), Math.max(total - 1, 0)));

/** Étape de cette recette qui a lancé le minuteur (à son nom, « Cuisson · ét. 3 · … »), sinon null. */
export function timerStep(timer: Pick<Timer, 'label'>, title: string, total: number): number | null {
  const n = Number(/^Cuisson · ét\. (\d+) · /u.exec(timer.label)?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= total && timer.label === timerLabel(title, n) ? n : null;
}

/** Ce que la télé affiche pour la recette `recipe` à l'étape de `session`, avec les minuteurs de la maison à `now`. */
export function screenCookView(recipe: Recipe, session: ScreenCookSession, timers: readonly Timer[], now: Date): ScreenCook {
  const content = recipe.ours;
  const total = content.steps.length;
  const index = clampStep(session.index, total);
  const title = content.title;
  const shown: ScreenCookTimer[] = timers.map((t) => {
    const left = (new Date(t.endsAt).getTime() - now.getTime()) / 1000;
    return { id: t.id, label: t.label, durationSeconds: t.durationSeconds, remainingSeconds: Math.max(0, Math.ceil(left)), ended: left <= 0, step: timerStep(t, title, total) };
  });
  const raw = content.steps[index];
  const step: ScreenCookStep | null = raw
    ? {
        number: index + 1,
        text: raw.text,
        section: raw.section,
        mode: content.appliance === 'cookeo' ? cookeoMode(raw.text) : null,
        durations: stepDurations(raw.text).map((d) => ({
          seconds: d.seconds,
          text: durationText(d.seconds),
          timerId: shown.find((t) => t.step === index + 1 && t.durationSeconds === d.seconds && !t.ended)?.id ?? null,
        })),
      }
    : null;
  const following = content.steps[index + 1];
  return { rev: session.rev, recipeId: recipe.id, title, index, total, step, next: following ? shorten(following.text, NEXT_STEP_MAX) : null, timers: shown };
}
