// Rechargement nocturne de la page de la tablette (`ui.nightlyReload` de homehub.yaml) : une fois par nuit, vers
// l'heure réglée, la page se recharge pour rendre la mémoire du WebView (tas JavaScript, textures WebGL de la
// reconnaissance des visages), qui grossit quand la page tourne des jours sans interruption. Seulement quand personne
// n'est là (veille affichée, ou ni contact ni visage depuis un moment) ; sinon on réessaie à la vérification suivante,
// jusqu'à la fin de la fenêtre. Jamais sur un téléphone. Renvoie la fonction d'arrêt. Au chargement suivant, la page
// sait si elle vient de ce rechargement (`reloadedByNight`, pour la page « Le NAS »).

const DONE_KEY = 'homehub:nightlyReload';
/** Après l'heure réglée, le rechargement peut encore se faire pendant ce délai (reporté tant que quelqu'un est là). */
export const NIGHTLY_WINDOW_MS = 2 * 60 * 60_000;
/** Sans veille affichée, il faut ce délai sans contact ni visage pour recharger. */
export const NIGHTLY_QUIET_MS = 10 * 60_000;
const CHECK_MS = 60_000;

export type ReloadTime = { hours: number; minutes: number };

/** « 03:00 » → { hours: 3, minutes: 0 } ; vide, null ou invalide : jamais. */
export function parseReloadTime(value: string | null | undefined): ReloadTime | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

/** Dernière échéance passée (aujourd'hui à l'heure réglée, ou hier si elle n'est pas encore arrivée), en heure locale. */
export function lastSlot(now: Date, at: ReloadTime): Date {
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), at.hours, at.minutes);
  if (slot.getTime() > now.getTime()) slot.setDate(slot.getDate() - 1);
  return slot;
}

/** Nuit d'une échéance (date locale), pour ne pas recharger deux fois la même nuit. */
export function nightKey(slot: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${slot.getFullYear()}-${pad(slot.getMonth() + 1)}-${pad(slot.getDate())}`;
}

export type NightlyState = {
  now: Date;
  at: ReloadTime | null;
  /** Chargement de la page (ms). */
  loadedAt: number;
  /** Dernière nuit déjà rechargée (nightKey), ou null. */
  doneNight: string | null;
  /** Page de téléphone (ou appareil qui n'est pas la tablette) : jamais. */
  phone: boolean;
  /** Veille affichée. */
  asleep: boolean;
  /** Une personne est reconnue. */
  present: boolean;
  /** Dernier contact ou dernier visage vu (ms). */
  lastActivity: number;
};

/** Faut-il recharger maintenant ? Renvoie la nuit à noter, ou null. */
export function nightlyReloadDue(s: NightlyState): string | null {
  if (s.phone || !s.at) return null;
  const slot = lastSlot(s.now, s.at);
  const now = s.now.getTime();
  if (now - slot.getTime() > NIGHTLY_WINDOW_MS) return null; // fenêtre passée : la nuit suivante
  if (s.loadedAt >= slot.getTime()) return null; // page déjà chargée cette nuit (déploiement, rechargement fait)
  const night = nightKey(slot);
  if (s.doneNight === night) return null;
  if (s.present) return null;
  const quiet = s.asleep || now - s.lastActivity >= NIGHTLY_QUIET_MS;
  return quiet ? night : null;
}

/**
 * La page chargée à `loadedAt` vient-elle du rechargement de la nuit ? Oui si la nuit notée juste avant de recharger
 * est celle de la dernière échéance et que le chargement tombe dans sa fenêtre. Un autre chargement plus tard dans la
 * même fenêtre (déploiement à 3 h 30) passerait aussi pour celui de la nuit : sans importance pour le suivi.
 */
export function reloadedByNight({ loadedAt, at, doneNight }: { loadedAt: number; at: ReloadTime | null; doneNight: string | null }): boolean {
  if (!at || !doneNight) return false;
  const slot = lastSlot(new Date(loadedAt), at);
  return doneNight === nightKey(slot) && loadedAt - slot.getTime() <= NIGHTLY_WINDOW_MS + CHECK_MS;
}

/** Nuit déjà rechargée, notée dans le stockage local (null : aucune, ou stockage indisponible). */
export function readDoneNight(storage: Pick<Storage, 'getItem'> | null = safeLocalStorage()): string | null {
  try {
    return storage?.getItem(DONE_KEY) ?? null;
  } catch {
    return null;
  }
}

export type NightlyWatchOptions = {
  /** Heure réglée (`ui.nightlyReload`), null : jamais. */
  at: string | null;
  /** État du moment (téléphone, veille, personne reconnue, dernière activité). */
  state(): Pick<NightlyState, 'phone' | 'asleep' | 'present' | 'lastActivity'>;
  loadedAt?: number;
  now?: () => number;
  reload?: () => void;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  intervalMs?: number;
};

export function watchNightlyReload({
  at,
  state,
  loadedAt = Date.now(),
  now = Date.now,
  reload = () => location.reload(),
  storage = safeLocalStorage(),
  intervalMs = CHECK_MS,
}: NightlyWatchOptions): () => void {
  const time = parseReloadTime(at);
  if (!time) return () => {};
  const check = () => {
    // stockage indisponible : l'heure de chargement suffit à ne pas boucler
    const doneNight = readDoneNight(storage);
    const night = nightlyReloadDue({ now: new Date(now()), at: time, loadedAt, doneNight, ...state() });
    if (!night) return;
    try {
      storage?.setItem(DONE_KEY, night);
    } catch {
      // idem
    }
    reload();
  };
  const timer = setInterval(check, intervalMs);
  return () => clearInterval(timer);
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
