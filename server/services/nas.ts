// Page « Le NAS » : le dernier relevé du NAS, l'état des sources de HomeHub, la version en service et le dernier
// chargement de la page de la tablette.
import type { NasData, TabletPage } from '../../shared/types.ts';
import type { NasStatusSource } from '../sources/nas-status.ts';
import type { SourceStatus } from '../sources/source-status.ts';
import type { TabletPageInput, TabletPageStore } from '../sources/tablet-page.ts';

export type NasService = {
  data(): Promise<NasData>;
  /** La page de la tablette vient d'être chargée (droits vérifiés par la route : la tablette seule). */
  tabletLoaded(input: TabletPageInput): Promise<TabletPage>;
};

export type NasServiceDeps = {
  nasStatus: NasStatusSource;
  sourceStatus: SourceStatus;
  tabletPage: TabletPageStore;
  version: string;
  /** Démarrage du serveur : en pratique, le dernier déploiement. */
  startedAt: Date;
};

export const createNasService = ({ nasStatus, sourceStatus, tabletPage, version, startedAt }: NasServiceDeps): NasService => ({
  async data() {
    return {
      status: await nasStatus.read(),
      sources: sourceStatus.list(),
      homehub: { version, startedAt: startedAt.toISOString() },
      tablet: await tabletPage.read(),
    };
  },
  tabletLoaded: (input) => tabletPage.record(input),
});
