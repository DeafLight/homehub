// Extension « Remplir le panier » : le remplissage en cours, gardé dans le stockage local de l'extension (sur
// l'appareil seulement ; ni compte, ni mot de passe, ni jeton de l'enseigne : seulement le panier copié et ce qu'on en
// a fait). Lu par le panneau et par le script de la page, qui se relaie d'une fiche à l'autre.
import type { Run } from './run.ts';

const KEY = 'run';

export async function loadRun(): Promise<Run | null> {
  const run = (await chrome.storage.local.get(KEY))[KEY] as Run | undefined;
  return run?.version === 1 ? run : null;
}

export const saveRun = (run: Run) => chrome.storage.local.set({ [KEY]: run });

export const clearRun = () => chrome.storage.local.remove(KEY);

/** Prévient quand le remplissage change (depuis le panneau ou une autre page). */
export function onRunChange(listener: (run: Run | null) => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) listener((changes[KEY].newValue as Run | undefined) ?? null);
  });
}
