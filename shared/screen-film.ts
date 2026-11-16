// Mode « film » des télés (fonction 15 de l'appli HomeHub TV) : pendant un film, les annonces n'interrompent plus la
// télé : les bandeaux (message écrit, minuteur, bus, pluie, rappels) deviennent discrets : petits, en bas à gauche, sans son ni
// focus. Le mode s'allume tout seul quand une appli de films est au premier plan (réglage de la tablette), ou à la main
// depuis la télécommande du téléphone ou le bouton Télé de la tablette. Règles pures, communes au serveur et au front.

/** Applis de films et séries reconnues par leur paquet Android TV : leur présence au premier plan allume le mode. */
export const FILM_APPS: readonly { package: string; name: string }[] = [
  { package: 'com.netflix.ninja', name: 'Netflix' },
  { package: 'com.disney.disneyplus', name: 'Disney+' },
  { package: 'com.amazon.amazonvideo.livingroom', name: 'Prime Video' },
  { package: 'com.apple.atve.androidtv.appletv', name: 'Apple TV' },
  { package: 'com.canal.android.canal', name: 'Canal+' },
  { package: 'com.wbd.stream', name: 'Max' },
  { package: 'com.cbs.ott', name: 'Paramount+' },
  { package: 'com.plexapp.android', name: 'Plex' },
  { package: 'org.xbmc.kodi', name: 'Kodi' },
  { package: 'org.videolan.vlc', name: 'VLC' },
];

/** L'appli `pkg` est-elle une appli de films ? */
export const filmApp = (pkg: string | null | undefined): boolean => pkg !== null && pkg !== undefined && FILM_APPS.some((a) => a.package === pkg);

/** Un mode film allumé à la main s'éteint seul au bout de ce temps (un film oublié ne bâillonne pas la télé). */
export const FILM_MANUAL_MS = 4 * 60 * 60_000;

/** Genres d'événements rendus discrets pendant un film (le serveur y ajoute `discreet: true`). */
export const DISCREET_KINDS = ['message', 'timer', 'bus', 'rain', 'reminder'] as const;
export type DiscreetKind = (typeof DISCREET_KINDS)[number];
export const isDiscreetKind = (kind: string): kind is DiscreetKind => (DISCREET_KINDS as readonly string[]).includes(kind);

/** Pourquoi le mode film est allumé (ou forcé éteint) : à la main, ou par l'appli au premier plan. */
export type FilmWhy = 'manual' | 'auto';

/** Mode film d'une télé, vu du téléphone et de la tablette. `until` : fin automatique d'un mode allumé à la main. */
export type ScreenFilm = { on: boolean; why: FilmWhy | null; until: string | null };

/**
 * Choix fait à la main sur une télé : allumer (jusqu'à `at` + FILM_MANUAL_MS) ou éteindre. Éteint à la main pendant
 * une appli de films, il ne vaut que tant que cette appli (`foreground` au moment du choix) reste au premier plan.
 */
export type FilmOverride = { on: boolean; at: number; foreground: string | null };

export const FILM_OFF: ScreenFilm = { on: false, why: null, until: null };

/**
 * Le choix à la main tient-il encore ? Non si la télé n'est plus allumée (veille, injoignable : le film est fini), si
 * le mode allumé a dépassé FILM_MANUAL_MS, ou si le mode éteint l'a été pour une autre appli que celle au premier plan.
 */
export function overrideHolds(override: FilmOverride, { power, foreground, now }: { power: 'on' | 'standby' | 'offline'; foreground: string | null; now: number }): boolean {
  if (power !== 'on') return false;
  if (override.on) return now - override.at < FILM_MANUAL_MS;
  return override.foreground === foreground;
}

/**
 * Mode film d'une télé : rien si elle n'est pas allumée ; sinon le choix à la main s'il tient, sinon allumé par une
 * appli de films au premier plan si le réglage automatique est actif.
 */
export function filmState({
  power,
  foreground,
  auto,
  override,
  now,
}: {
  power: 'on' | 'standby' | 'offline';
  foreground: string | null;
  auto: boolean;
  override: FilmOverride | null;
  now: number;
}): ScreenFilm {
  if (power !== 'on') return FILM_OFF;
  if (override && overrideHolds(override, { power, foreground, now })) {
    return override.on ? { on: true, why: 'manual', until: new Date(override.at + FILM_MANUAL_MS).toISOString() } : { on: false, why: 'manual', until: null };
  }
  return auto && filmApp(foreground) ? { on: true, why: 'auto', until: null } : FILM_OFF;
}

/** Ligne d'état du mode film (télécommande, tablette) ; null : éteint sans raison particulière. */
export function filmLabel(film: ScreenFilm | null | undefined): string | null {
  if (!film) return null;
  if (film.on) return film.why === 'auto' ? 'Allumé par l’appli en cours : s’éteint en la quittant' : 'Allumé à la main : s’éteint télé en veille, ou au bout de 4 h';
  return film.why === 'manual' ? 'Mode film : éteint pour cette appli' : null;
}

/** Le bouton « Mode film » sert-il ? Seulement télé allumée (en veille ou injoignable, rien ne passe). */
export const filmToggle = (screen: { power: 'on' | 'standby' | 'offline'; film?: ScreenFilm }): boolean => screen.power === 'on' && screen.film !== undefined;

/** Compte rendu du bouton. */
export const filmDone = (film: ScreenFilm) =>
  film.on ? 'Mode film allumé : annonces discrètes, messages vocaux sur le Google Home' : 'Mode film éteint : les annonces reviennent sur la télé';
