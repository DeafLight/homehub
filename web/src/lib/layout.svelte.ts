// Choix du dashboard des élèves, le temps de comparer : « classique » (frises d'aujourd'hui et de demain, toutes les
// cartes) ou « focus » (une frise, la carte du moment, le reste en tuiles). Réglé sur l'appareil lui-même (roue dentée
// de la tablette), gardé dans son navigateur ; classique par défaut.
const KEY = 'homehub.dashboardLayout';

export type DashboardLayout = 'classic' | 'focus';

function read(): DashboardLayout {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'focus' ? 'focus' : 'classic';
  } catch {
    return 'classic';
  }
}

let current = $state<DashboardLayout>(read());

export const dashboardLayout = {
  get current() {
    return current;
  },
  set(layout: DashboardLayout) {
    current = layout;
    try {
      globalThis.localStorage?.setItem(KEY, layout);
    } catch {
      // Stockage indisponible : le choix vaut jusqu'au rechargement.
    }
  },
};
