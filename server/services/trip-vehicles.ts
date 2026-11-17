// Positions réelles des véhicules du trajet (chantier « Prochain trajet », version 4), sans HTTP : parmi tout le flux
// VehiclePositions, seulement les véhicules des courses demandées par le téléphone (celles de son trajet), avec l'âge
// de chaque position. Le reste du flux n'est jamais renvoyé.
import type { VehicleFix } from '../../shared/trip.ts';
import type { GtfsRtVehicle } from '../sources/gtfs-rt.ts';
import { gtfsTripId } from '../sources/motis.ts';

/** Courses dont on demande les véhicules, au plus, en une fois (le véhicule où l'on est et le suivant suffisent). */
export const MAX_VEHICLE_TRIPS = 4;

/** Véhicules des courses MOTIS `tripIds` trouvés dans le flux ; une position sans heure (âge inconnu) est écartée. */
export function vehicleFixes(feed: GtfsRtVehicle[], tripIds: string[], nowMs: number): VehicleFix[] {
  const byTrip = new Map(feed.map((v) => [v.tripId, v]));
  return [...new Set(tripIds)].flatMap((tripId): VehicleFix[] => {
    const v = byTrip.get(gtfsTripId(tripId));
    if (!v?.timestamp) return [];
    return [
      {
        tripId,
        lat: v.lat,
        lon: v.lon,
        ...(v.bearing !== undefined && { bearing: v.bearing }),
        age: Math.max(0, Math.round(nowMs / 1000 - v.timestamp)),
        ...(v.stopId && { stopId: v.stopId }),
        ...(v.status && { status: v.status }),
      },
    ];
  });
}
