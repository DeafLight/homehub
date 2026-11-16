// Mode « film » des télés (fonction 15, règles dans shared/screen-film.ts), en mémoire : les choix faits à la main
// (téléphone ou tablette) et le réglage automatique (appli de films au premier plan, panneau Télés de la tablette).
// Le hub demande `discreet(id)` à chaque envoi pour rendre les bandeaux discrets. Un choix à la main est oublié dès que la télé
// n'est plus allumée, au plus tard au tour suivant du guet (FILM_SWEEP_MS) ; un redémarrage du serveur les oublie tous.
import { filmState, overrideHolds, type FilmOverride, type ScreenFilm } from '../../shared/screen-film.ts';
import type { Clock } from '../sources/types.ts';
import type { ScreenHub } from './screens.ts';

/** Fréquence du guet qui oublie les choix des télés éteintes. */
export const FILM_SWEEP_MS = 10_000;

export type ScreenFilmService = ReturnType<typeof createScreenFilm>;

export function createScreenFilm({ hub, clock, auto = true }: { hub: Pick<ScreenHub, 'power' | 'stateOf'>; clock: Clock; auto?: boolean }) {
  const overrides = new Map<string, FilmOverride>();
  let automatic = auto;

  const context = (id: string) => ({ power: hub.power(id), foreground: hub.stateOf(id)?.foreground ?? null, now: clock().getTime() });

  /** Oublie les choix qui ne tiennent plus (télé éteinte, délai passé, autre appli). */
  function sweep() {
    for (const [id, override] of overrides) if (!overrideHolds(override, context(id))) overrides.delete(id);
  }

  function state(id: string): ScreenFilm {
    const ctx = context(id);
    const override = overrides.get(id) ?? null;
    if (override && !overrideHolds(override, ctx)) overrides.delete(id);
    return filmState({ ...ctx, auto: automatic, override: overrides.get(id) ?? null });
  }

  return {
    state,
    on: (id: string) => state(id).on,
    /** Les bandeaux de la télé `id` doivent-ils être discrets ? */
    discreet: (id: string) => state(id).on,

    /** Choix à la main ; null si la télé n'est pas allumée (rien à régler). */
    set(id: string, on: boolean): ScreenFilm | null {
      const ctx = context(id);
      if (ctx.power !== 'on') return null;
      overrides.set(id, { on, at: ctx.now, foreground: ctx.foreground });
      return state(id);
    },

    /** Réglage automatique (appli de films au premier plan), lu au démarrage puis à chaque changement sur la tablette. */
    setAuto(value: boolean) {
      automatic = value;
    },
    get auto() {
      return automatic;
    },

    forget: (id: string) => void overrides.delete(id),
    sweep,

    /** Guette jusqu'à la fin du processus. */
    start() {
      setInterval(sweep, FILM_SWEEP_MS).unref();
    },
  };
}
