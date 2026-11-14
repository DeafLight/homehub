// Routes du front : l'accueil, un dashboard par profil (/p/<id>), et des pages de détail (météo, semaine, NAS,
// listes, stock, scanner, téléphones reliés, visages, routines, transports, vacances scolaires, sport et séance guidée,
// recettes, menu de la semaine). Une recette : /recette/<id>, /recette/<id>/modifier, /recette/<id>/cuisine (retour : le carnet), et
// /recette/nouvelle. Sur les téléphones : l'appli (/m, /m/taches, /m/agenda, /m/mots, /m/sport, /m/recettes, /m/camera), son
// scanner (/m/scanner), son stock (/m/stock), le menu de la semaine (/m/menu), une recette (/m/recette/<id>, /m/recette/<id>/modifier,
// /m/recette/nouvelle), l'appairage (/appairer) et le partage (/partager). Le scanner du téléphone peut s'ouvrir
// directement dans un mode : /m/scanner?mode=ranger ou ?mode=jete (QR des affichettes).
// Une page de détail porte dans son chemin la page qui l'a ouverte, pour y revenir : /meteo (depuis
// l'accueil) ou /meteo/p/<id> (depuis un profil). Le retour survit ainsi au rechargement.
import type { ScanMode } from './scan.ts';

export type PageRoute = { name: 'home' } | { name: 'dashboard'; ownerId: string };
export type DetailName = 'weather' | 'week' | 'nas' | 'lists' | 'phones' | 'faces' | 'routines' | 'transit' | 'holidays' | 'scan' | 'stock' | 'sport' | 'workout' | 'recipes' | 'menu';
export type PhoneTab = 'shopping' | 'tasks' | 'agenda' | 'notes' | 'sport' | 'recipes' | 'camera';
/** Recette ouverte : la fiche, son édition, ou le mode cuisine (tablette). `id` null : nouvelle recette (édition). */
export type RecipeMode = 'view' | 'edit' | 'cook';
export type Route =
  | PageRoute
  | { name: DetailName; back: PageRoute }
  | { name: 'phone'; tab: PhoneTab }
  | { name: 'pair' }
  | { name: 'phonescan'; mode?: ScanMode }
  | { name: 'phonestock' }
  | { name: 'phonemenu' }
  | { name: 'recipe'; id: string | null; mode: RecipeMode }
  | { name: 'phonerecipe'; id: string | null; mode: Exclude<RecipeMode, 'cook'> }
  | { name: 'share' };

export const HOME_PATH = '/';
const DETAIL_PREFIXES: Record<DetailName, string> = { weather: '/meteo', week: '/semaine', nas: '/nas', lists: '/listes', phones: '/telephones', faces: '/visages', routines: '/routines', transit: '/transports', holidays: '/vacances', scan: '/scanner', stock: '/stock', sport: '/sport', workout: '/seance', recipes: '/recettes', menu: '/menu' };

export const dashboardPath = (ownerId: string) => `/p/${encodeURIComponent(ownerId)}`;

const PHONE_PATHS: Record<PhoneTab, string> = { shopping: '/m', tasks: '/m/taches', agenda: '/m/agenda', notes: '/m/mots', sport: '/m/sport', recipes: '/m/recettes', camera: '/m/camera' };
export const phonePath = (tab: PhoneTab) => PHONE_PATHS[tab];
export const PAIR_PATH = '/appairer';
export const SHARE_PATH = '/partager';
export const PHONE_SCAN_PATH = '/m/scanner';
/** Valeurs de `?mode=` du scanner : un contrat (QR des affichettes imprimées), à ne jamais changer. */
export const SCAN_MODE_PARAMS: Record<ScanMode, string> = { in: 'ranger', out: 'jete' };
/** Mode demandé par la valeur de `?mode=` ; rien pour une valeur absente ou inconnue. */
export function scanModeOfParam(value: string | null): ScanMode | undefined {
  return (Object.keys(SCAN_MODE_PARAMS) as ScanMode[]).find((mode) => SCAN_MODE_PARAMS[mode] === value);
}
/** Scanner du téléphone, ouvert dans un mode ou non. */
export const phoneScanPath = (mode?: ScanMode) => (mode ? `${PHONE_SCAN_PATH}?mode=${SCAN_MODE_PARAMS[mode]}` : PHONE_SCAN_PATH);
export const PHONE_STOCK_PATH = '/m/stock';
export const PHONE_MENU_PATH = '/m/menu';
const NEW_RECIPE = 'nouvelle';
const RECIPE_SUFFIX: Record<RecipeMode, string> = { view: '', edit: '/modifier', cook: '/cuisine' };

/** Fiche, édition ou mode cuisine d'une recette (tablette) ; `id` null : nouvelle recette. */
export const recipePath = (id: string | null, mode: RecipeMode = 'view') =>
  id === null ? `/recette/${NEW_RECIPE}` : `/recette/${encodeURIComponent(id)}${RECIPE_SUFFIX[mode]}`;
/** De même, sur le téléphone (pas de mode cuisine). */
export const phoneRecipePath = (id: string | null, mode: Exclude<RecipeMode, 'cook'> = 'view') => `/m${recipePath(id, mode)}`;

/**
 * Ce qui distingue une route pour le reste de l'écran, au même endroit plutôt qu'en conditions éparses :
 * - `phone` : page du téléphone, sans accueil de tablette (ni retour automatique, ni veille, ni minuteurs) ;
 * - `holdsActor` : page de la tablette où la personne reconnue reste retenue sans la caméra : le scanner (la caméra
 *   lit les codes) et la séance guidée (loin de la caméra, sans toucher l'écran). Ni retour à l'accueil, ni veille ;
 * - `camera` : la page se sert elle-même de la caméra (visages) : pas de reconnaissance en même temps ;
 * - `awake` : la page reste ouverte sans contact (recette en cuisine, édition) : ni retour à l'accueil, ni veille ;
 *   la reconnaissance continue (lancer un minuteur, enregistrer).
 */
type RouteTraits = { phone?: true; holdsActor?: true; camera?: true; awake?: true };
const TRAITS: Partial<Record<Route['name'], RouteTraits>> = {
  phone: { phone: true },
  pair: { phone: true },
  share: { phone: true },
  phonescan: { phone: true },
  phonestock: { phone: true },
  phonemenu: { phone: true },
  phonerecipe: { phone: true },
  recipe: { awake: true },
  scan: { holdsActor: true },
  workout: { holdsActor: true },
  faces: { camera: true },
};
const traits = (route: Route): RouteTraits => TRAITS[route.name] ?? {};

export const holdsActor = (route: Route) => traits(route).holdsActor === true;

/** Routes du téléphone. */
export const isPhoneRoute = (route: Route) => traits(route).phone === true;

/**
 * Retour à l'accueil sans contact, et veille : sur les pages de la tablette, sauf celles qui retiennent la personne
 * et celles qu'on garde ouvertes (une recette : sa fiche se lit de loin, mains occupées).
 */
export const returnsHomeWhenIdle = (route: Route) => !isPhoneRoute(route) && !holdsActor(route) && traits(route).awake !== true;
export const allowsScreensaver = returnsHomeWhenIdle;

/** Reconnaissance faciale en continu : sur les pages de la tablette, sauf celles qui retiennent la personne ou prennent la caméra. */
export const watchesPresence = (route: Route) => !isPhoneRoute(route) && !holdsActor(route) && traits(route).camera !== true;

/**
 * Caméra en direct : seules les pages de la tablette diffusent (une page du téléphone ouverte depuis la tablette ou en
 * local passerait sinon pour elle).
 */
export const hostsLiveCamera = (route: Route) => !isPhoneRoute(route);

/** Minuteurs de cuisine : sur toutes les pages de la tablette. */
export const showsTimers = (route: Route) => !isPhoneRoute(route);

export function routePath(route: Route): string {
  if (route.name === 'home') return HOME_PATH;
  if (route.name === 'dashboard') return dashboardPath(route.ownerId);
  if (route.name === 'phone') return phonePath(route.tab);
  if (route.name === 'pair') return PAIR_PATH;
  if (route.name === 'share') return SHARE_PATH;
  if (route.name === 'phonescan') return phoneScanPath(route.mode);
  if (route.name === 'phonestock') return PHONE_STOCK_PATH;
  if (route.name === 'phonemenu') return PHONE_MENU_PATH;
  if (route.name === 'recipe') return recipePath(route.id, route.mode);
  if (route.name === 'phonerecipe') return phoneRecipePath(route.id, route.mode);
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

/** Route d'une adresse (chemin, éventuellement suivi de `?…` : seul le scanner du téléphone en lit le mode). */
export function parseRoute(location: string): Route {
  const [pathname, search = ''] = location.split('?', 2);
  const path = pathname.replace(/\/$/, '') || HOME_PATH;
  for (const [tab, phone] of Object.entries(PHONE_PATHS) as [PhoneTab, string][]) {
    if (path === phone) return { name: 'phone', tab };
  }
  if (path === PAIR_PATH) return { name: 'pair' };
  if (path === SHARE_PATH) return { name: 'share' };
  if (path === PHONE_SCAN_PATH) {
    const mode = scanModeOfParam(new URLSearchParams(search).get('mode'));
    return mode ? { name: 'phonescan', mode } : { name: 'phonescan' };
  }
  if (path === PHONE_STOCK_PATH) return { name: 'phonestock' };
  if (path === PHONE_MENU_PATH) return { name: 'phonemenu' };
  const recipe = /^(\/m)?\/recette\/([^/]+)(?:\/(modifier|cuisine))?$/u.exec(path);
  if (recipe) {
    const [, phone, rawId, suffix] = recipe;
    let id: string | null;
    try {
      id = rawId === NEW_RECIPE ? null : decodeURIComponent(rawId);
    } catch {
      return { name: 'home' };
    }
    const mode: RecipeMode = id === null || suffix === 'modifier' ? 'edit' : suffix === 'cuisine' ? 'cook' : 'view';
    if (phone) return { name: 'phonerecipe', id, mode: mode === 'cook' ? 'view' : mode };
    return { name: 'recipe', id, mode };
  }
  for (const [name, prefix] of Object.entries(DETAIL_PREFIXES) as [DetailName, string][]) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { name, back: parsePage(pathname.slice(prefix.length) || HOME_PATH) };
    }
  }
  return parsePage(pathname);
}
