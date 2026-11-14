// Pause, reprise et volume de ce qui passe sur une télé appairée (fonction 6, docs/appli-tele.md) : commandes de la
// tablette traduites en touches de la télécommande, refus du volume quand la télé a un volume fixe (barre de son par
// HDMI ARC), et l'événement « À table ! » (bandeau et pause), commun au téléphone et à la tablette.
import { randomUUID } from 'node:crypto';
import { type MediaAction, type RemoteKey, type ScreenEventBody, type ScreenVolume, VOLUME_KEYS } from '../../shared/screen.ts';
import { tvTitle } from '../../shared/tv.ts';

export const VOLUME_FIXED = 'Volume fixe sur cette télé (son par la barre de son) : pause et reprise seulement';

/** Touches d'une commande de la tablette (« À table ! » a son propre événement). */
export const MEDIA_KEYS: Record<Exclude<MediaAction, 'dinner'>, RemoteKey> = {
  pause: 'pause',
  play: 'play',
  voldown: 'voldown',
  volup: 'volup',
  mute: 'mute',
};

/** Des touches de volume vers une télé au volume fixe : elles ne feraient rien, on le dit plutôt. */
export const refusesVolume = (volume: ScreenVolume | null | undefined, keys: readonly RemoteKey[]) =>
  volume === 'fixed' && keys.some((k) => VOLUME_KEYS.includes(k));

/**
 * « À table ! » : pause de ce qui passe et bandeau qui le dit, « De la part d'Alex » (ou « HomeHub » sans auteur :
 * code parent tapé sur la tablette). Point d'accroche du message écrit en bandeau (fonction 2) : quand il existera,
 * le bandeau passera par lui, la pause restant ici.
 */
export function dinnerEvent(sender: string | null): ScreenEventBody {
  const subtitle = sender ? tvTitle(sender).replace(/^Message /u, 'De la part ') : 'HomeHub';
  return { kind: 'key', id: randomUUID(), keys: ['pause'], notice: { title: 'À table !', subtitle } };
}
