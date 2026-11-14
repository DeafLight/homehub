// Routeur minimal basé sur l'History API : la route courante est un état réactif. L'adresse lue comprend la requête
// (`?mode=` du scanner du téléphone) : y naviguer alors que la page est ouverte met la route à jour.
import { parseRoute, type Route } from './route.ts';

export type Router = {
  readonly route: Route;
  navigate(path: string): void;
  destroy(): void;
};

export function createRouter(win: Window = window): Router {
  const here = () => win.location.pathname + win.location.search;
  let route = $state<Route>(parseRoute(here()));
  const onPopState = () => {
    route = parseRoute(here());
  };
  win.addEventListener('popstate', onPopState);

  return {
    get route() {
      return route;
    },
    navigate(path) {
      if (path === here()) return;
      win.history.pushState(null, '', path);
      route = parseRoute(path);
    },
    destroy() {
      win.removeEventListener('popstate', onPopState);
    },
  };
}
