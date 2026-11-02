// Routes du front : l'accueil, et un dashboard par profil (/p/<id>).

export type Route = { name: 'home' } | { name: 'dashboard'; ownerId: string };

export const HOME_PATH = '/';

export const dashboardPath = (ownerId: string) => `/p/${encodeURIComponent(ownerId)}`;

export function parseRoute(pathname: string): Route {
  const match = /^\/p\/([^/]+)\/?$/.exec(pathname);
  if (!match) return { name: 'home' };
  try {
    return { name: 'dashboard', ownerId: decodeURIComponent(match[1]) };
  } catch {
    return { name: 'home' };
  }
}
