// Commandes de ce qui passe sur la télé depuis la tablette (fonction 6) : boutons permis selon l'état de la télé et
// son volume (fixe avec une barre de son : pause seulement), explication à afficher, qui peut commander (parent
// reconnu, sinon le code parent s'il est défini) et le compte rendu de chaque commande. TvMedia.svelte ne garde que
// les appels et l'affichage.
import type { MediaAction, MediaScreen, ScreenVolume } from '../../../shared/screen.ts';

/** Pause et « À table ! » (`pause`) ; volume (`volume`), refusé quand il est fixe. */
export function mediaButtons(screen: Pick<MediaScreen, 'power' | 'control' | 'volume'>): { pause: boolean; volume: boolean } {
  const reachable = screen.power !== 'offline' && screen.control !== null && screen.control !== 'none';
  return { pause: reachable, volume: reachable && screen.volume !== 'fixed' };
}

/** Volume fixe : le son sort par la barre de son, que la télé ne règle pas. */
export const VOLUME_FIXED_HINT = 'Volume fixe : le son passe par la barre de son. Pause et reprise seulement, le volume se règle avec sa télécommande.';

/** Volume fixe, à signaler sous les touches (null : volume réglable ou inconnu). */
export const volumeHint = (volume: ScreenVolume | null) => (volume === 'fixed' ? VOLUME_FIXED_HINT : null);

/** Explication sous le nom de la télé ; null : tout marche. */
export function mediaHint(screen: Pick<MediaScreen, 'power' | 'control' | 'volume'>): string | null {
  if (screen.power === 'offline') return 'La télé ne répond pas : éteinte, ou l’appli HomeHub TV n’est pas lancée.';
  if (screen.control === null || screen.control === 'none') return 'Appli HomeHub TV trop ancienne pour ces commandes : la mettre à jour.';
  return volumeHint(screen.volume);
}

/**
 * Qui commande depuis la tablette : `parent` reconnu (tout part tout de suite), sinon `code` (le code parent, demandé
 * une fois tant que le panneau reste ouvert), sinon `nobody` (aucun code parent défini : il faut un parent reconnu).
 */
export function commander(current: { parent: boolean } | null, parentCode: boolean): 'parent' | 'code' | 'nobody' {
  if (current?.parent) return 'parent';
  return parentCode ? 'code' : 'nobody';
}

export const NOBODY_HINT = 'Réservé aux parents : regarde la tablette pour être reconnu.';

/** Compte rendu d'une commande réussie. */
export const MEDIA_DONE: Record<MediaAction, string> = {
  pause: 'Pause sur la télé',
  play: 'Lecture reprise',
  volup: 'Son plus fort',
  voldown: 'Son moins fort',
  mute: 'Son coupé ou remis',
  dinner: 'À table ! Pause et bandeau sur la télé',
};
