// Routes du front : l'accueil, un dashboard par profil (/p/<id>), et des pages de détail (météo, semaine).
// Une page de détail porte dans son chemin la page qui l'a ouverte, pour y revenir : /meteo (depuis
// l'accueil) ou /meteo/p/<id> (depuis un profil). Le retour survit ainsi au rechargement.

export type PageRoute = { name: 'home' } | { name: 'dashboard'; ownerId: string };
export type DetailName = 'weather' | 'week';
export type Route = PageRoute | { name: DetailName; back: PageRoute };

export const HOME_PATH = '/';
const DETAIL_PREFIXES: Record<DetailName, string> = { weather: '/meteo', week: '/semaine' };

export const dashboardPath = (ownerId: string) => `/p/${encodeURIComponent(ownerId)}`;

export function routePath(route: Route): string {
  if (route.name === 'home') return HOME_PATH;
  if (route.name === 'dashboard') return dashboardPath(route.ownerId);
  const prefix = DETAIL_PREFIXES[route.name];
  return route.back.name === 'home' ? prefix : `${prefix}${routePath(route.back)}`;
}

/** Page à laquelle revenir depuis `route` : elle-même, ou la page d'origine pour une page de détail. */
export const pageOf = (route: Route): PageRoute => (route.name === 'home' || route.name === 'dashboard' ? route : route.back);

/** Chemin de la page de détail `name` ouverte depuis `from` (depuis une autre page de détail : même retour). */
export const detailPath = (name: DetailName, from: Route) => routePath({ name, back: pageOf(from) });

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
  for (const [name, prefix] of Object.entries(DETAIL_PREFIXES) as [DetailName, string][]) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { name, back: parsePage(pathname.slice(prefix.length) || HOME_PATH) };
    }
  }
  return parsePage(pathname);
}
