// Routeur minimal basé sur l'History API : la route courante est un état réactif.
import { parseRoute, type Route } from './route.ts';

export type Router = {
  readonly route: Route;
  navigate(path: string): void;
  destroy(): void;
};

export function createRouter(win: Window = window): Router {
  let route = $state<Route>(parseRoute(win.location.pathname));
  const onPopState = () => {
    route = parseRoute(win.location.pathname);
  };
  win.addEventListener('popstate', onPopState);

  return {
    get route() {
      return route;
    },
    navigate(path) {
      if (path === win.location.pathname) return;
      win.history.pushState(null, '', path);
      route = parseRoute(path);
    },
    destroy() {
      win.removeEventListener('popstate', onPopState);
    },
  };
}
