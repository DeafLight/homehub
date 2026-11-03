// Téléphone appairé : son jeton et son profil, gardés dans le navigateur du téléphone (localStorage).
// La tablette n'en a pas : elle est reconnue par le serveur à son adresse.

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

/** Nom du téléphone affiché sur la tablette : son modèle quand Chrome le donne, sinon un nom générique. */
export async function deviceName(nav: Navigator = navigator): Promise<string> {
  type UAData = { getHighEntropyValues(hints: string[]): Promise<{ model?: string; platform?: string }> };
  const uaData = (nav as Navigator & { userAgentData?: UAData }).userAgentData;
  try {
    const { model, platform } = (await uaData?.getHighEntropyValues(['model', 'platform'])) ?? {};
    if (model) return model;
    if (platform) return `Téléphone ${platform}`;
  } catch {
    // pas d'information sur le modèle
  }
  return /iPhone/.test(nav.userAgent) ? 'iPhone' : 'Téléphone';
}
