// Logique du bouton « Sur la télé » de la fiche recette, sans DOM (testée) : la télé où la recette est déjà en mode
// cuisine, le libellé du lancement selon le nombre de télés, et la ligne d'état du pilotage (« Étape 2 / 5 »).
import type { ScreenCookTarget } from '../../../shared/screen-cook.ts';

/** La télé où cette recette est en mode cuisine (la première trouvée), sinon null. */
export const cookingOn = (targets: readonly ScreenCookTarget[], recipeId: string) => targets.find((t) => t.cook?.recipeId === recipeId) ?? null;

/** Libellé du bouton de lancement : « Sur la télé » s'il n'y en a qu'une, sinon « Sur Télé du salon ». */
export const launchLabel = (target: Pick<ScreenCookTarget, 'name'>, count: number) => (count > 1 ? `Sur ${target.name}` : 'Sur la télé');

/** État du pilotage : « Télé du salon · étape 2 / 5 » (« sans étapes » pour une recette qui n'en a pas). */
export function pilotText(target: ScreenCookTarget): string {
  const cook = target.cook;
  if (!cook) return target.name;
  return cook.total ? `${target.name} · étape ${cook.index + 1} / ${cook.total}` : `${target.name} · sans étapes`;
}
