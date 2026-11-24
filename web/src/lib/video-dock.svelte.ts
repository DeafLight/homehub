// État de la vidéo YouTube de la tablette, partagé entre le lecteur (VideoDock.svelte) et ce qui doit s'effacer
// pendant la lecture : retour à l'accueil sur inactivité (App.svelte), veille (Screensaver.svelte), rechargements de
// version et de nuit. Un seul lecteur par page : un objet du module suffit.
import type { TabletVideo } from '../../../shared/video.ts';

class VideoDockState {
  /** Vidéo affichée (grande ou en vignette), ou null. */
  current = $state<TabletVideo | null>(null);
  /** En vignette déplaçable plutôt qu'en grand. */
  mini = $state(false);
  /** Elle se lit (ou va se lire : vraie dès l'arrivée, la lecture se lance toute seule). */
  playing = $state(false);

  /** La vidéo tourne : pas de veille, pas de retour à l'accueil, rechargements différés jusqu'à la fin. */
  get holds(): boolean {
    return this.current !== null && this.playing;
  }

  /** Nouvelle vidéo : elle remplace la précédente et repasse en grand. */
  show(video: TabletVideo) {
    this.current = video;
    this.mini = false;
    this.playing = true;
  }

  close() {
    this.current = null;
    this.mini = false;
    this.playing = false;
  }
}

export const videoDock = new VideoDockState();
