// Téléphone appairé : son jeton et son profil, gardés dans le navigateur du téléphone (localStorage).
// La tablette n'en a pas : elle est reconnue par le serveur à son adresse.

import { systemName } from './device-names.ts';

const KEY = 'homehub.phone';

export type PhonePairing = { token: string; ownerId: string };

export function loadPairing(storage: Storage | undefined = globalThis.localStorage): PhonePairing | null {
  try {
    const value = JSON.parse(storage?.getItem(KEY) ?? 'null');
    return typeof value?.token === 'string' && typeof value?.ownerId === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function savePairing(pairing: PhonePairing, storage: Storage | undefined = globalThis.localStorage): void {
  storage?.setItem(KEY, JSON.stringify(pairing));
}

export function clearPairing(storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // stockage indisponible : rien à effacer
  }
}

/**
 * Ce que le téléphone dit de lui pour la tablette : son modèle quand Chrome le donne (code brut, rendu lisible à
 * l'affichage), sinon un nom générique ; et son système (« Android 15 », « iOS 18 ») quand on le connaît.
 */
export async function deviceInfo(nav: Navigator = navigator): Promise<{ name: string; system: string | null }> {
  type Hints = { model?: string; platform?: string; platformVersion?: string };
  type UAData = { getHighEntropyValues(hints: string[]): Promise<Hints> };
  const uaData = (nav as Navigator & { userAgentData?: UAData }).userAgentData;
  let hints: Hints = {};
  try {
    hints = (await uaData?.getHighEntropyValues(['model', 'platform', 'platformVersion'])) ?? {};
  } catch {
    // pas d'information sur le modèle
  }
  const iphone = /iPhone/.test(nav.userAgent);
  const name = hints.model || (iphone ? 'iPhone' : hints.platform ? `Téléphone ${hints.platform}` : 'Téléphone');
  return { name, system: systemName(nav.userAgent, hints.platform, hints.platformVersion) };
}
