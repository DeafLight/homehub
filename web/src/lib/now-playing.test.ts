// Tests de la carte « À l'écran » de la télécommande (fonction 18) : veille, injoignable, appli seule, programme en
// lecture qui avance, en pause, télé en direct sans durée, appli qui ne publie pas de titre.
import { describe, expect, it } from 'vitest';
import type { RemoteNowPlaying } from '../../../shared/now-playing.ts';
import { nowPlayingView } from './now-playing.ts';

const film: RemoteNowPlaying = {
  package: 'fr.exemple.cine',
  app: 'Ciné Club',
  title: 'Les Voisins du dessus',
  subtitle: 'Saison 2 · Épisode 4',
  state: 'playing',
  positionMs: 600_000,
  durationMs: 2_400_000,
  artworkId: 'abc',
};
const on = { power: 'on' as const, foreground: { package: 'fr.exemple.cine', name: 'Ciné Club' }, nowPlaying: film };

describe('carte « À l’écran »', () => {
  it('télé en veille ou injoignable : une phrase, même si une session traîne', () => {
    expect(nowPlayingView({ ...on, power: 'standby' }, 0)).toEqual({ kind: 'none', text: 'Télé en veille : rien à l’écran.' });
    expect(nowPlayingView({ ...on, power: 'offline' }, 0)).toEqual({ kind: 'none', text: 'Télé éteinte ou injoignable.' });
  });

  it('programme en lecture : titre, épisode, avancée qui suit le temps écoulé', () => {
    expect(nowPlayingView(on, 0)).toEqual({
      kind: 'playing',
      app: 'Ciné Club',
      package: 'fr.exemple.cine',
      title: 'Les Voisins du dessus',
      subtitle: 'Saison 2 · Épisode 4',
      paused: false,
      status: 'Lecture',
      progress: 0.25,
      times: '10:00 / 40:00',
    });
    expect(nowPlayingView(on, 60_000)).toMatchObject({ progress: 0.275, times: '11:00 / 40:00' });
  });

  it('en pause : la position ne bouge plus', () => {
    expect(nowPlayingView({ ...on, nowPlaying: { ...film, state: 'paused' } }, 60_000)).toMatchObject({ paused: true, status: 'En pause', times: '10:00 / 40:00' });
  });

  it('télé en direct sans durée, appli sans titre : pas de barre, le nom de l’appli en titre', () => {
    const live = { ...film, package: 'fr.exemple.box', app: 'Box TV', title: null, subtitle: 'Chaîne 2', durationMs: null };
    expect(nowPlayingView({ ...on, nowPlaying: live }, 0)).toMatchObject({ title: 'Box TV', subtitle: 'Chaîne 2', progress: null, times: null });
  });

  it('appli au premier plan sans session média, ou rien de connu', () => {
    expect(nowPlayingView({ ...on, nowPlaying: null }, 0)).toEqual({ kind: 'app', app: 'Ciné Club', package: 'fr.exemple.cine', text: 'Pas de programme annoncé par l’appli.' });
    expect(nowPlayingView({ power: 'on', foreground: null }, 0)).toEqual({ kind: 'none', text: 'Appli en cours inconnue.' });
  });
});
