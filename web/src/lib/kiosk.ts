// Clé de la tablette : donnée une fois dans son adresse de démarrage (https://…/#key=…, réglage de Fully Kiosk),
// gardée dans le navigateur de la tablette et envoyée avec chaque requête (en-tête X-Kiosk-Key). Placée après « # »,
// elle n'est jamais envoyée dans l'adresse, donc absente des journaux du proxy ; on la retire aussitôt de l'adresse.

const KEY = 'homehub.kiosk';
/** Copie en mémoire, si le navigateur refuse le stockage. */
let memoryKey: string | null = null;

export function loadKioskKey(storage: Storage | undefined = globalThis.localStorage): string | null {
  try {
    return storage?.getItem(KEY) || memoryKey;
  } catch {
    return memoryKey;
  }
}

/** Lit `#key=…` dans l'adresse : l'enregistre et le retire de l'adresse. Sans clé, l'adresse reste telle quelle. */
export function takeKioskKeyFromUrl(
  win: Pick<Window, 'location' | 'history'> = window,
  storage: Storage | undefined = globalThis.localStorage,
): boolean {
  const key = new URLSearchParams(win.location.hash.slice(1)).get('key')?.trim();
  if (!key) return false;
  memoryKey = key;
  try {
    storage?.setItem(KEY, key);
  } catch {
    // stockage indisponible : la copie en mémoire vaut jusqu'au prochain rechargement
  }
  win.history.replaceState(null, '', win.location.pathname + win.location.search);
  return true;
}
