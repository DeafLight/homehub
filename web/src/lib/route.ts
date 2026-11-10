// Routes du front : l'accueil, un dashboard par profil (/p/<id>), et des pages de détail (météo, semaine, NAS,
// listes, stock, scanner, téléphones reliés, visages, routines, transports, sport et séance guidée). Sur les téléphones : l'appli (/m, /m/taches, /m/agenda,
// /m/mots, /m/sport), son scanner (/m/scanner), son stock (/m/stock), l'appairage (/appairer) et le partage (/partager).
// Une page de détail porte dans son chemin la page qui l'a ouverte, pour y revenir : /meteo (depuis
// l'accueil) ou /meteo/p/<id> (depuis un profil). Le retour survit ainsi au rechargement.

export type PageRoute = { name: 'home' } | { name: 'dashboard'; ownerId: string };
export type DetailName = 'weather' | 'week' | 'nas' | 'lists' | 'phones' | 'faces' | 'routines' | 'transit' | 'scan' | 'stock' | 'sport' | 'workout';
export type PhoneTab = 'shopping' | 'tasks' | 'agenda' | 'notes' | 'sport';
export type Route =
  | PageRoute
  | { name: DetailName; back: PageRoute }
  | { name: 'phone'; tab: PhoneTab }
  | { name: 'pair' }
  | { name: 'phonescan' }
  | { name: 'phonestock' }
  | { name: 'share' };

export const HOME_PATH = '/';
const DETAIL_PREFIXES: Record<DetailName, string> = { weather: '/meteo', week: '/semaine', nas: '/nas', lists: '/listes', phones: '/telephones', faces: '/visages', routines: '/routines', transit: '/transports', scan: '/scanner', stock: '/stock', sport: '/sport', workout: '/seance' };

export const dashboardPath = (ownerId: string) => `/p/${encodeURIComponent(ownerId)}`;

const PHONE_PATHS: Record<PhoneTab, string> = { shopping: '/m', tasks: '/m/taches', agenda: '/m/agenda', notes: '/m/mots', sport: '/m/sport' };
export const phonePath = (tab: PhoneTab) => PHONE_PATHS[tab];
export const PAIR_PATH = '/appairer';
export const SHARE_PATH = '/partager';
export const PHONE_SCAN_PATH = '/m/scanner';
export const PHONE_STOCK_PATH = '/m/stock';

/**
 * Ce qui distingue une route pour le reste de l'écran, au même endroit plutôt qu'en conditions éparses :
 * - `phone` : page du téléphone, sans accueil de tablette (ni retour automatique, ni veille, ni minuteurs) ;
 * - `holdsActor` : page de la tablette où la personne reconnue reste retenue sans la caméra : le scanner (la caméra
 *   lit les codes) et la séance guidée (loin de la caméra, sans toucher l'écran). Ni retour à l'accueil, ni veille ;
 * - `camera` : la page se sert elle-même de la caméra (visages) : pas de reconnaissance en même temps.
 */
type RouteTraits = { phone?: true; holdsActor?: true; camera?: true };
const TRAITS: Partial<Record<Route['name'], RouteTraits>> = {
  phone: { phone: true },
  pair: { phone: true },
  share: { phone: true },
  phonescan: { phone: true },
  phonestock: { phone: true },
  scan: { holdsActor: true },
  workout: { holdsActor: true },
  faces: { camera: true },
};
const traits = (route: Route): RouteTraits => TRAITS[route.name] ?? {};

export const holdsActor = (route: Route) => traits(route).holdsActor === true;

/** Routes du téléphone. */
export const isPhoneRoute = (route: Route) => traits(route).phone === true;

/** Retour à l'accueil sans contact, et veille : sur les pages de la tablette, sauf celles qui retiennent la personne. */
export const returnsHomeWhenIdle = (route: Route) => !isPhoneRoute(route) && !holdsActor(route);
export const allowsScreensaver = returnsHomeWhenIdle;

/** Reconnaissance faciale en continu : de même, et pas sur une page qui prend la caméra. */
export const watchesPresence = (route: Route) => returnsHomeWhenIdle(route) && traits(route).camera !== true;

/** Minuteurs de cuisine : sur toutes les pages de la tablette. */
export const showsTimers = (route: Route) => !isPhoneRoute(route);

export function routePath(route: Route): string {
  if (route.name === 'home') return HOME_PATH;
  if (route.name === 'dashboard') return dashboardPath(route.ownerId);
  if (route.name === 'phone') return phonePath(route.tab);
  if (route.name === 'pair') return PAIR_PATH;
  if (route.name === 'share') return SHARE_PATH;
  if (route.name === 'phonescan') return PHONE_SCAN_PATH;
  if (route.name === 'phonestock') return PHONE_STOCK_PATH;
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
  if (path === PHONE_SCAN_PATH) return { name: 'phonescan' };
  if (path === PHONE_STOCK_PATH) return { name: 'phonestock' };
  for (const [name, prefix] of Object.entries(DETAIL_PREFIXES) as [DetailName, string][]) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { name, back: parsePage(pathname.slice(prefix.length) || HOME_PATH) };
    }
  }
  return parsePage(pathname);
}
