// Routes du front : l'accueil, un dashboard par profil (/p/<id>), et des pages de détail (météo, semaine, NAS,
// listes, téléphones reliés, visages, routines, transports). Sur les téléphones : l'appli (/m, /m/taches, /m/agenda, /m/mots), l'appairage (/appairer) et le partage (/partager).
// Une page de détail porte dans son chemin la page qui l'a ouverte, pour y revenir : /meteo (depuis
// l'accueil) ou /meteo/p/<id> (depuis un profil). Le retour survit ainsi au rechargement.

export type PageRoute = { name: 'home' } | { name: 'dashboard'; ownerId: string };
export type DetailName = 'weather' | 'week' | 'nas' | 'lists' | 'phones' | 'faces' | 'routines' | 'transit' | 'scantest';
export type PhoneTab = 'shopping' | 'tasks' | 'agenda' | 'notes';
export type Route =
  | PageRoute
  | { name: DetailName; back: PageRoute }
  | { name: 'phone'; tab: PhoneTab }
  | { name: 'pair' }
  | { name: 'share' };

export const HOME_PATH = '/';
const DETAIL_PREFIXES: Record<DetailName, string> = { weather: '/meteo', week: '/semaine', nas: '/nas', lists: '/listes', phones: '/telephones', faces: '/visages', routines: '/routines', transit: '/transports', scantest: '/test-scan' };

export const dashboardPath = (ownerId: string) => `/p/${encodeURIComponent(ownerId)}`;

const PHONE_PATHS: Record<PhoneTab, string> = { shopping: '/m', tasks: '/m/taches', agenda: '/m/agenda', notes: '/m/mots' };
export const phonePath = (tab: PhoneTab) => PHONE_PATHS[tab];
export const PAIR_PATH = '/appairer';
export const SHARE_PATH = '/partager';

/** Routes du téléphone : pas de retour automatique à l'accueil de la tablette. */
export const isPhoneRoute = (route: Route) => route.name === 'phone' || route.name === 'pair' || route.name === 'share';

export function routePath(route: Route): string {
  if (route.name === 'home') return HOME_PATH;
  if (route.name === 'dashboard') return dashboardPath(route.ownerId);
  if (route.name === 'phone') return phonePath(route.tab);
  if (route.name === 'pair') return PAIR_PATH;
  if (route.name === 'share') return SHARE_PATH;
  const prefix = DETAIL_PREFIXES[route.name];
  return route.back.name === 'home' ? prefix : `${prefix}${routePath(route.back)}`;
}

/** Page à laquelle revenir depuis `route` : elle-même, ou la page d'origine pour une page de détail. */
export const pageOf = (route: Route): PageRoute =>
  route.name === 'home' || route.name === 'dashboard' ? route : 'back' in route ? route.back : { name: 'home' };

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
  const path = pathname.replace(/\/$/, '') || HOME_PATH;
  for (const [tab, phone] of Object.entries(PHONE_PATHS) as [PhoneTab, string][]) {
    if (path === phone) return { name: 'phone', tab };
  }
  if (path === PAIR_PATH) return { name: 'pair' };
  if (path === SHARE_PATH) return { name: 'share' };
  for (const [name, prefix] of Object.entries(DETAIL_PREFIXES) as [DetailName, string][]) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { name, back: parsePage(pathname.slice(prefix.length) || HOME_PATH) };
    }
  }
  return parsePage(pathname);
}
