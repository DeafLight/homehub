// Routes du front : l'accueil, un dashboard par profil (/p/<id>), et la météo détaillée.
// La page météo porte dans son chemin la page qui l'a ouverte, pour y revenir : /meteo (depuis
// l'accueil) ou /meteo/p/<id> (depuis un profil). Le retour survit ainsi au rechargement.

export type PageRoute = { name: 'home' } | { name: 'dashboard'; ownerId: string };
export type Route = PageRoute | { name: 'weather'; back: PageRoute };

export const HOME_PATH = '/';
const WEATHER_PREFIX = '/meteo';

export const dashboardPath = (ownerId: string) => `/p/${encodeURIComponent(ownerId)}`;

export function routePath(route: Route): string {
  if (route.name === 'dashboard') return dashboardPath(route.ownerId);
  if (route.name === 'weather') return route.back.name === 'home' ? WEATHER_PREFIX : `${WEATHER_PREFIX}${routePath(route.back)}`;
  return HOME_PATH;
}

/** Chemin de la page météo ouverte depuis `from` (depuis la météo elle-même : on garde le même retour). */
export const weatherPath = (from: Route) => routePath(from.name === 'weather' ? from : { name: 'weather', back: from });

function parsePage(pathname: string): PageRoute {
  const match = /^\/p\/([^/]+)\/?$/.exec(pathname);
  if (!match) return { name: 'home' };
  try {
    return { name: 'dashboard', ownerId: decodeURIComponent(match[1]) };
  } catch {
    return { name: 'home' };
  }
}

export function parseRoute(pathname: string): Route {
  const weather = /^\/meteo(\/.*)?$/.exec(pathname);
  if (weather) return { name: 'weather', back: parsePage(weather[1] ?? HOME_PATH) };
  return parsePage(pathname);
}
