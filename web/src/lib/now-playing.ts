// Carte « À l'écran » de la télécommande (fonction 18) : ce que la télé montre, dit simplement. Télé en veille ou
// injoignable : une phrase ; allumée : l'appli au premier plan, et le programme quand l'appli publie sa session média
// (titre, sous-titre, lecture ou pause, avancée). La position avance seule entre deux relevés du serveur
// (`elapsedMs` : temps écoulé sur le téléphone depuis la réponse, sans dépendre de l'heure du serveur).
import { formatPlayTime, PLAYBACK_LABELS, positionAfter } from '../../../shared/now-playing.ts';
import type { RemoteScreen } from '../../../shared/screen.ts';

export type NowPlayingView =
  /** Rien à l'écran (veille, injoignable) ou rien de connu. */
  | { kind: 'none'; text: string }
  /** Une appli au premier plan, sans programme connu. */
  | { kind: 'app'; app: string; package: string; text: string }
  | {
      kind: 'playing';
      app: string;
      package: string;
      title: string;
      subtitle: string | null;
      paused: boolean;
      /** « Lecture », « En pause », « Chargement… ». */
      status: string;
      /** Avancée de 0 à 1 ; null sans durée (télé en direct, appli muette). */
      progress: number | null;
      /** « 12:04 / 45:00 » ; null sans durée. */
      times: string | null;
    };

export function nowPlayingView(screen: Pick<RemoteScreen, 'power' | 'foreground' | 'nowPlaying'>, elapsedMs: number): NowPlayingView {
  if (screen.power === 'standby') return { kind: 'none', text: 'Télé en veille : rien à l’écran.' };
  if (screen.power === 'offline') return { kind: 'none', text: 'Télé éteinte ou injoignable.' };
  const playing = screen.nowPlaying;
  if (playing) {
    const position = positionAfter(playing, elapsedMs);
    const timed = position !== null && playing.durationMs !== null;
    return {
      kind: 'playing',
      app: playing.app,
      package: playing.package,
      // Sans titre (certaines applis ne publient que l'état) : le nom de l'appli tient lieu de titre.
      title: playing.title ?? playing.app,
      subtitle: playing.subtitle,
      paused: playing.state !== 'playing',
      status: PLAYBACK_LABELS[playing.state],
      progress: timed ? Math.min(1, position / playing.durationMs!) : null,
      times: timed ? `${formatPlayTime(position)} / ${formatPlayTime(playing.durationMs!)}` : null,
    };
  }
  if (screen.foreground) return { kind: 'app', app: screen.foreground.name, package: screen.foreground.package, text: 'Pas de programme annoncé par l’appli.' };
  return { kind: 'none', text: 'Appli en cours inconnue.' };
}
