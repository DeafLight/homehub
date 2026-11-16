// Annonce destinée à une télé, et son secours (fonction 7 de l'appli télé) : si la télé est injoignable (plus
// d'attente longue depuis GONE_MS) ou allumée écran éteint (veille rapide, qui garde le réseau), l'annonce part sur
// l'appareil de secours de cette télé (un Google Home, par Cast) ; si la télé la refuse parce que son écran vient de
// s'éteindre (SCREEN_OFF_REASON), aussi. Mode film (fonction 15, services/screen-film.ts) : télé allumée où passe un
// film, l'annonce part aussi sur le secours (raison `film`) ; sans secours, la télé la reçoit comme avant. Télé vue
// présente qui n'accuse pas réception à temps (débranchée depuis moins de GONE_MS) : le message lui est retiré et part
// sur le secours (raison `silent`) ; une télé qui l'a reçu mais se tait le garde (pas de double lecture).
import { SCREEN_OFF_REASON, screenFallbackNotice, type ScreenFallbackReason, type ScreenFallbackSettings, type ScreenReport } from '../../shared/screen.ts';
import type { AppConfig } from '../config.ts';
import type { ScreenFallbackStore } from '../sources/screen-fallbacks.ts';
import { SCREEN_MISSED, type ScreenHub } from './screens.ts';

export type CastDevice = AppConfig['cast']['devices'][number];

/** Issue d'une annonce : lue (sur la télé ou sur le secours, avec la raison), ou refusée par la télé sans secours. */
export type Announced = { device: string; fallback: { reason: ScreenFallbackReason; notice: string } | null } | { refused: ScreenReport & { ok: false } };

export type ScreenFallback = ReturnType<typeof createScreenFallback>;

export function createScreenFallback({
  hub,
  cast,
  store,
  film = () => false,
}: {
  hub: Pick<ScreenHub, 'power'>;
  cast: () => AppConfig['cast'];
  store: ScreenFallbackStore;
  /** Un film passe-t-il sur la télé (mode film) ? */
  film?: (id: string) => boolean;
}) {
  /** Appareils Cast utilisables : aucun sans `cast.mediaUrl` (ils ne pourraient pas télécharger le message). */
  const usable = () => {
    const { devices, mediaUrl } = cast();
    return mediaUrl ? devices : [];
  };

  /** Appareil de secours de la télé `id` : celui réglé, sinon (jamais réglé) la première enceinte. */
  async function deviceOf(id: string): Promise<CastDevice | null> {
    const choices = await store.all();
    const devices = usable();
    if (id in choices) return devices.find((d) => d.id === choices[id]) ?? null;
    return devices.find((d) => d.kind === 'speaker') ?? null;
  }

  /** Pourquoi l'annonce ne doit pas passer par la télé `id` en ce moment (null : allumée, sans film). */
  function reasonOf(id: string): ScreenFallbackReason | null {
    const power = hub.power(id);
    if (power !== 'on') return power;
    return film(id) ? 'film' : null;
  }

  return {
    deviceOf,
    reasonOf,

    /** Réglages des télés `ids`, pour la tablette. */
    async settings(ids: string[]): Promise<ScreenFallbackSettings> {
      const choices = await store.all();
      const devices = usable();
      const auto = devices.find((d) => d.kind === 'speaker')?.id ?? null;
      return {
        devices: devices.map(({ id, name, kind }) => ({ id, name, kind })),
        screens: ids.map((id) => (id in choices ? { id, device: devices.some((d) => d.id === choices[id]) ? choices[id]! : null, auto: false } : { id, device: auto, auto: true })),
      };
    },

    /** Règle le secours de la télé `id` ; false si l'appareil n'est pas un appareil Cast utilisable. */
    async choose(id: string, device: string | null): Promise<boolean> {
      if (device !== null && !usable().some((d) => d.id === device)) return false;
      await store.set(id, device);
      return true;
    },

    forget: (id: string) => store.remove(id),

    /**
     * Fait passer une annonce par la télé `id` (`toScreen`, qui rend le compte rendu de la télé), ou par son secours
     * (`toDevice`) quand la télé est éteinte, injoignable, refuse écran éteint, ou n'a pas reçu le message à temps.
     * `toScreen(rescue)` : `rescue` dit qu'un secours attend (la télé doit alors accuser réception vite, sinon
     * SCREEN_MISSED). Sans secours, la télé reçoit l'annonce comme avant (une télé injoignable : 503 de `hub.send`).
     * Les erreurs de `toDevice` remontent telles quelles.
     */
    async announce(id: string, toScreen: (rescue: boolean) => Promise<ScreenReport>, toDevice: (device: CastDevice) => Promise<void>, screenName: string): Promise<Announced> {
      const device = await deviceOf(id);
      const viaDevice = async (reason: ScreenFallbackReason): Promise<Announced> => {
        await toDevice(device!);
        return { device: device!.name, fallback: { reason, notice: screenFallbackNotice(device!.name, reason) } };
      };
      const reason = reasonOf(id);
      if (reason && device) return viaDevice(reason);
      const report = await toScreen(device !== null);
      if (report.ok) return { device: screenName, fallback: null };
      if (report.reason === SCREEN_OFF_REASON && device) return viaDevice('standby');
      if (report.reason === SCREEN_MISSED && device) return viaDevice('silent');
      return { refused: report };
    },
  };
}
