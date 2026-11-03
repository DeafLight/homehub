// Page « Le NAS » : le dernier relevé du NAS, l'état des sources de HomeHub et la version en service.
import type { NasData } from '../../shared/types.ts';
import type { NasStatusSource } from '../sources/nas-status.ts';
import type { SourceStatus } from '../sources/source-status.ts';

export type NasService = { data(): Promise<NasData> };

export type NasServiceDeps = {
  nasStatus: NasStatusSource;
  sourceStatus: SourceStatus;
  version: string;
  /** Démarrage du serveur : en pratique, le dernier déploiement. */
  startedAt: Date;
};

export const createNasService = ({ nasStatus, sourceStatus, version, startedAt }: NasServiceDeps): NasService => ({
  async data() {
    return {
      status: await nasStatus.read(),
      sources: sourceStatus.list(),
      homehub: { version, startedAt: startedAt.toISOString() },
    };
  },
});
