// Sonnerie des minuteurs sur un Google Home : quand un minuteur de la maison se termine, l'enceinte Cast choisie par un
// parent (réglage `timerCast` des alertes, panneau Télés de la tablette) lit la sonnerie (services/ringtone.ts, une
// dizaine de secondes), téléchargée à `cast.mediaUrl` + /api/cast/ringtone.wav. Minuteur arrêté pendant qu'elle sonne :
// le lecteur Cast est fermé. Rien n'attend l'appareil : un échec est seulement écrit dans le journal.
import type { CastConfig } from '../config.ts';
import type { ScreenAlertStore } from '../sources/screen-alerts.ts';
import { type CastMedia, type CastTarget, castPlay } from './cast.ts';
import { RINGTONE_TYPE } from './ringtone.ts';

export const RINGTONE_PATH = '/api/cast/ringtone.wav';

export type TimerCast = {
  /** Fait sonner l'enceinte choisie pour ce minuteur (rien si « Aucun ») ; ne rejette jamais. */
  ring(timer: { id: string; label: string }): Promise<void>;
  /** Minuteur arrêté : sa sonnerie s'arrête si elle passe encore. */
  stop(timerId: string): void;
};

/** Enceintes proposées pour la sonnerie : celles de cast.devices (pas la télé), s'il y a une adresse des médias. */
export function timerCastDevices(cast: CastConfig): { id: string; name: string }[] {
  return cast.mediaUrl ? cast.devices.filter((d) => d.kind === 'speaker').map(({ id, name }) => ({ id, name })) : [];
}

export function createTimerCast({
  rules,
  alerts,
  play = castPlay,
  logger = console,
}: {
  rules: () => CastConfig;
  alerts: Pick<ScreenAlertStore, 'get'>;
  /** Lecture sur l'appareil (remplaçable dans les tests). */
  play?: (target: CastTarget, media: CastMedia, options: { log: (step: string) => void; signal: AbortSignal }) => Promise<void>;
  logger?: Pick<Console, 'log' | 'error'>;
}): TimerCast {
  /** Sonneries en cours, par minuteur. */
  const playing = new Map<string, AbortController>();

  return {
    async ring(timer) {
      try {
        const deviceId = (await alerts.get()).timerCast;
        if (!deviceId) return;
        const cast = rules();
        const device = cast.devices.find((d) => d.id === deviceId && d.kind === 'speaker');
        if (!device || !cast.mediaUrl) {
          logger.error(`Sonnerie du minuteur : appareil Cast « ${deviceId} » absent de cast.devices, ou cast.mediaUrl manquante`);
          return;
        }
        playing.get(timer.id)?.abort();
        const controller = new AbortController();
        playing.set(timer.id, controller);
        const log = (text: string) => logger.log(`Cast ${device.id} (minuteur) : ${text}`);
        const url = `${cast.mediaUrl.replace(/\/+$/, '')}${RINGTONE_PATH}`;
        // On garde de quoi l'arrêter jusqu'à ce que le minuteur le soit (stop, appelé par le guetteur).
        await play({ host: device.host, port: device.port }, { url, contentType: RINGTONE_TYPE, title: timer.label || 'Minuteur' }, { log, signal: controller.signal });
      } catch (err) {
        logger.error('Sonnerie du minuteur sur le Google Home :', (err as Error).message);
      }
    },

    stop(timerId) {
      const controller = playing.get(timerId);
      if (!controller) return;
      playing.delete(timerId);
      controller.abort();
    },
  };
}
