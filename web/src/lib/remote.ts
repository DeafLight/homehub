// Télécommande de la télé sur le téléphone (fonction 17) : ce que l'écran peut proposer selon l'état de la télé et le
// moyen d'action de l'appli, les textes d'état, et la file des touches (une rafale de flèches part en un seul envoi
// pendant que le précédent est en route). Remote.svelte ne garde que les appels et l'affichage.
import { REMOTE_MAX_KEYS, type RemoteKey, type RemotePower, type RemoteScreen } from '../../../shared/screen.ts';
import { formatAgo } from './format.ts';

export const POWER_LABELS: Record<RemotePower, string> = { on: 'allumée', standby: 'en veille', offline: 'injoignable' };

/** « Télé du salon · allumée ». */
export const statusLine = (screen: Pick<RemoteScreen, 'name' | 'power'>) => `${screen.name} · ${POWER_LABELS[screen.power]}`;

/**
 * Ce que la télécommande peut faire : `keys` toutes les touches et le texte (injecteur par adb), `basic` Retour,
 * Accueil, lecture, volume (aussi par le secours de l'appli), `apps` lancer une appli. Télé en veille : l'écran s'allume
 * d'abord, les touches restent permises (elles la réveillent souvent). Télé injoignable : rien que « Allumer ».
 */
export function capabilities(screen: Pick<RemoteScreen, 'power' | 'control'>): { keys: boolean; basic: boolean; apps: boolean } {
  if (screen.power === 'offline' || screen.control === null || screen.control === 'none') return { keys: false, basic: false, apps: false };
  if (screen.control === 'adb') return { keys: true, basic: true, apps: true };
  return { keys: false, basic: true, apps: true };
}

/** Explication sous l'en-tête quand une partie de la télécommande manque ; null : tout marche. */
export function controlHint(screen: Pick<RemoteScreen, 'power' | 'control' | 'canWake'>): string | null {
  if (screen.power === 'offline') {
    return screen.canWake ? 'La télé ne répond pas : « Allumer » la réveille par Cast.' : 'La télé ne répond pas : éteinte, ou l’appli HomeHub TV n’est pas lancée.';
  }
  switch (screen.control) {
    case 'adb':
      return null;
    case 'authorize':
      return 'Sur la télé, accepte « Autoriser le débogage ? » (cocher « Toujours autoriser ») pour les flèches et le clavier.';
    case 'accessibility':
      return 'Flèches et clavier indisponibles (adb de la télé coupé) : Retour, Accueil, lecture et volume seulement.';
    default:
      return 'Appli HomeHub TV trop ancienne pour la télécommande : la mettre à jour.';
  }
}

/** Date de la liste des applis : « Liste reçue de la télé il y a 2 h », ou rien si elle ne l'a pas encore envoyée. */
export const appsDate = (at: string | null, now: Date) => (at ? `Liste reçue de la télé ${formatAgo(new Date(at), now)}` : null);

/**
 * File des touches : une touche part tout de suite si rien n'est en route ; sinon elle attend et part avec celles qui
 * suivent, en un seul envoi (REMOTE_MAX_KEYS au plus). Une erreur est signalée une fois par envoi raté.
 */
export function createKeyQueue(send: (keys: RemoteKey[]) => Promise<void>, onError: (message: string) => void, onSent: () => void = () => {}) {
  const pending: RemoteKey[] = [];
  let busy = false;

  async function flush() {
    busy = true;
    try {
      while (pending.length) {
        const batch = pending.splice(0, REMOTE_MAX_KEYS);
        try {
          await send(batch);
          onSent();
        } catch (err) {
          onError((err as Error).message);
        }
      }
    } finally {
      busy = false;
    }
  }

  return {
    press(key: RemoteKey) {
      pending.push(key);
      if (!busy) void flush();
    },
    /** Touches en attente (pour les tests et l'affichage). */
    get waiting() {
      return pending.length;
    },
  };
}
