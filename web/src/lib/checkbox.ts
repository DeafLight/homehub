// Case à cocher pilotée par l'état : au toucher, elle reprend aussitôt sa valeur, et ne change qu'une fois l'état
// mis à jour (après vérification du droit d'écrire). Renvoie la valeur demandée.
export function revert(input: HTMLInputElement, current: boolean): boolean {
  const wanted = input.checked;
  input.checked = current;
  return wanted;
}
