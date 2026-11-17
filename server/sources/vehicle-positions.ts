// Positions réelles des bus et trams Irigo (chantier « Prochain trajet », version 4) : flux GTFS-RT VehiclePositions
// de l'open data d'Angers Loire Métropole (jeu « Réseau urbain Irigo » de transport.data.gouv.fr, sans clé), dont les
// `trip_id` sont ceux du GTFS. Lu seulement à la demande, quand une carte en route est ouverte, et gardé 15 s en
// mémoire : tous les téléphones partagent la même lecture. Le flux ne contient que des véhicules, jamais de personne.
import type { Logger } from '../config-store.ts';
import { type GtfsRtVehicle, parseVehiclePositions } from './gtfs-rt.ts';
import type { SourceStatus } from './source-status.ts';
import type { Clock } from './types.ts';

export const VEHICLE_POSITIONS_URL = 'https://ara-api.enroute.mobi/irigo/gtfs/vehicle-positions';
/** Lecture partagée entre téléphones : au plus une toutes les 15 s. */
export const VEHICLES_MAX_AGE_MS = 15_000;
/** En panne : la dernière lecture sert encore 2 min (le téléphone juge ensuite l'âge de chaque position). */
const VEHICLES_STALE_MS = 2 * 60_000;
/** Après un échec, pas de nouvel essai avant 30 s. */
const RETRY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const LABEL = 'Irigo (positions des véhicules)';

export type VehiclePositionSource = {
  /** Véhicules du flux, lu il y a moins de 15 s (ou relu maintenant) ; vide si le flux ne répond pas. */
  vehicles(): Promise<GtfsRtVehicle[]>;
};

export type VehiclePositionDeps = { fetchFn?: typeof fetch; clock: Clock; logger: Logger; status?: SourceStatus; url?: string };

export function createVehiclePositionSource({ fetchFn = fetch, clock, logger, status, url = VEHICLE_POSITIONS_URL }: VehiclePositionDeps): VehiclePositionSource {
  let last: { at: number; vehicles: GtfsRtVehicle[] } | null = null;
  let failedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;

  async function load() {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      last = { at: clock().getTime(), vehicles: parseVehiclePositions(new Uint8Array(await res.arrayBuffer())) };
      status?.record(LABEL);
    } catch (err) {
      failedAt = clock().getTime();
      status?.record(LABEL, err);
      logger.error(`${LABEL} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    async vehicles() {
      const now = clock().getTime();
      if ((!last || now - last.at >= VEHICLES_MAX_AGE_MS) && now - failedAt >= RETRY_MS) {
        inFlight ??= load().finally(() => (inFlight = null));
        await inFlight;
      }
      return last && clock().getTime() - last.at <= VEHICLES_STALE_MS ? last.vehicles : [];
    },
  };
}
