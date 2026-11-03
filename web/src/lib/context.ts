// Dépendances partagées par les écrans, assemblées par main.ts et fournies par le contexte Svelte
// au lieu d'être importées directement : les composants restent testables et découplés.
import { getContext } from 'svelte';
import type { PublicConfig } from '../../../shared/types.ts';
import type { Actor } from './actor.svelte.ts';
import type { Api } from './api.ts';
import type { Clock } from './clock.svelte.ts';
import type { Profile } from './profiles.ts';
import type { Router } from './router.svelte.ts';

export type AppContext = {
  api: Api;
  /** Personne reconnue devant la tablette. */
  actor: Actor;
  config: PublicConfig;
  profiles: Profile[];
  clock: Clock;
  router: Router;
  navigate(path: string): void;
};

const KEY = Symbol('homehub');

/** Contexte à passer à `mount()` (option `context`). */
export const appContextMap = (context: AppContext) => new Map<symbol, AppContext>([[KEY, context]]);

export function getAppContext(): AppContext {
  const context = getContext<AppContext | undefined>(KEY);
  if (!context) throw new Error('AppContext absent : le composant doit être rendu sous App.svelte');
  return context;
}
