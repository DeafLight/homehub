// Tests des règles du mode film (fonction 15) : applis de films reconnues, mode allumé par l'appli ou à la main, fin
// (télé éteinte, délai d'un mode manuel, autre appli après un « éteindre » à la main), ligne d'état, phrase du secours.
import { describe, expect, it } from 'vitest';
import { FILM_MANUAL_MS, FILM_OFF, filmApp, filmDone, filmLabel, filmState, filmToggle, isDiscreetKind, overrideHolds } from './screen-film.ts';
import { screenFallbackNotice } from './screen.ts';

const NETFLIX = 'com.netflix.ninja';
const AUTRE = 'fr.exemple.video';
const T = Date.UTC(2026, 10, 16, 20, 30);

describe('mode film : règles', () => {
  it('reconnaît les applis de films, pas les autres ni l’absence d’appli', () => {
    expect(filmApp(NETFLIX)).toBe(true);
    expect(filmApp('org.videolan.vlc')).toBe(true);
    expect(filmApp('com.google.android.youtube.tv')).toBe(false);
    expect(filmApp(null)).toBe(false);
    expect(filmApp(undefined)).toBe(false);
  });

  it('automatique : allumé par une appli de films si le réglage est actif, jamais télé éteinte', () => {
    expect(filmState({ power: 'on', foreground: NETFLIX, auto: true, override: null, now: T })).toEqual({ on: true, why: 'auto', until: null });
    expect(filmState({ power: 'on', foreground: NETFLIX, auto: false, override: null, now: T })).toEqual(FILM_OFF);
    expect(filmState({ power: 'on', foreground: AUTRE, auto: true, override: null, now: T })).toEqual(FILM_OFF);
    expect(filmState({ power: 'standby', foreground: NETFLIX, auto: true, override: null, now: T })).toEqual(FILM_OFF);
    expect(filmState({ power: 'offline', foreground: NETFLIX, auto: true, override: { on: true, at: T, foreground: null }, now: T })).toEqual(FILM_OFF);
  });

  it('à la main : allumé quatre heures au plus, quelle que soit l’appli', () => {
    const override = { on: true, at: T, foreground: AUTRE };
    expect(filmState({ power: 'on', foreground: 'fr.exemple.box', auto: true, override, now: T + 60_000 })).toEqual({
      on: true,
      why: 'manual',
      until: new Date(T + FILM_MANUAL_MS).toISOString(),
    });
    expect(overrideHolds(override, { power: 'on', foreground: AUTRE, now: T + FILM_MANUAL_MS - 1 })).toBe(true);
    expect(overrideHolds(override, { power: 'on', foreground: AUTRE, now: T + FILM_MANUAL_MS })).toBe(false);
    expect(filmState({ power: 'on', foreground: AUTRE, auto: true, override, now: T + FILM_MANUAL_MS })).toEqual(FILM_OFF);
    expect(overrideHolds(override, { power: 'standby', foreground: AUTRE, now: T })).toBe(false);
  });

  it('éteint à la main pendant Netflix : tient tant que Netflix reste devant, puis l’automatique reprend', () => {
    const override = { on: false, at: T, foreground: NETFLIX };
    expect(filmState({ power: 'on', foreground: NETFLIX, auto: true, override, now: T + 3 * 60 * 60_000 })).toEqual({ on: false, why: 'manual', until: null });
    expect(overrideHolds(override, { power: 'on', foreground: AUTRE, now: T })).toBe(false);
    expect(filmState({ power: 'on', foreground: AUTRE, auto: true, override, now: T })).toEqual(FILM_OFF);
  });

  it('genres rendus discrets : bandeaux seulement, pas la voix ni la télécommande', () => {
    expect(['message', 'timer', 'bus', 'rain', 'reminder'].every(isDiscreetKind)).toBe(true);
    expect(['voice', 'key', 'media', 'cook', 'workout', 'timers', 'timer-clear'].some(isDiscreetKind)).toBe(false);
  });

  it('ligne d’état et phrase du secours', () => {
    expect(filmLabel({ on: true, why: 'auto', until: null })).toBe('Allumé par l’appli en cours : s’éteint en la quittant');
    expect(filmLabel({ on: true, why: 'manual', until: 'x' })).toBe('Allumé à la main : s’éteint télé en veille, ou au bout de 4 h');
    expect(filmLabel({ on: false, why: 'manual', until: null })).toBe('Mode film : éteint pour cette appli');
    expect(filmLabel(FILM_OFF)).toBeNull();
    expect(filmLabel(undefined)).toBeNull();
    expect(screenFallbackNotice('Google Home du salon', 'film')).toBe('Mode film : lu sur Google Home du salon.');
    expect(screenFallbackNotice('Google Home du salon', 'standby')).toBe('Télé éteinte : lu sur Google Home du salon.');
  });

  it('bouton Mode film : seulement télé allumée et serveur qui le connaît ; compte rendu', () => {
    expect(filmToggle({ power: 'on', film: FILM_OFF })).toBe(true);
    expect(filmToggle({ power: 'standby', film: FILM_OFF })).toBe(false);
    expect(filmToggle({ power: 'offline', film: FILM_OFF })).toBe(false);
    expect(filmToggle({ power: 'on' })).toBe(false);
    expect(filmDone({ on: true, why: 'manual', until: null })).toMatch(/^Mode film allumé/);
    expect(filmDone(FILM_OFF)).toMatch(/^Mode film éteint/);
  });
});
