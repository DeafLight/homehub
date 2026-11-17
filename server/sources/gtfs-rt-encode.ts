// Encodeur minimal d'un flux GTFS-RT de positions des véhicules (protobuf), le pendant de gtfs-rt.ts : sert aux tests,
// à la fixture binaire (fixtures/vehicle-positions.pb) et au faux flux du monde fictif. Jamais de vraie course : les
// identifiants et positions viennent des appelants, tous fictifs.
import type { GtfsRtVehicle, VehicleStatus } from './gtfs-rt.ts';

const varint = (value: number | bigint): number[] => {
  let n = BigInt(value);
  const out: number[] = [];
  do {
    const byte = Number(n & 0x7fn);
    n >>= 7n;
    out.push(n > 0n ? byte | 0x80 : byte);
  } while (n > 0n);
  return out;
};
const key = (no: number, type: number) => varint((no << 3) | type);
export const protoNumber = (no: number, value: number | bigint) => [...key(no, 0), ...varint(value)];
export const protoBytes = (no: number, body: number[]) => [...key(no, 2), ...varint(body.length), ...body];
export const protoString = (no: number, s: string) => protoBytes(no, [...new TextEncoder().encode(s)]);
export function protoFloat(no: number, value: number): number[] {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setFloat32(0, value, true);
  return [...key(no, 5), ...out];
}

const STATUS: Record<VehicleStatus, number> = { incoming: 0, stopped: 1, 'in-transit': 2 };

/** Entité VehiclePosition d'un véhicule. */
function vehicleEntity(id: string, v: GtfsRtVehicle): number[] {
  const position = [...protoFloat(1, v.lat), ...protoFloat(2, v.lon), ...(v.bearing !== undefined ? protoFloat(3, v.bearing) : [])];
  const vehicle = [
    ...protoBytes(1, protoString(1, v.tripId)),
    ...protoBytes(2, position),
    ...(v.stopSequence !== undefined ? protoNumber(3, v.stopSequence) : []),
    ...(v.status !== undefined ? protoNumber(4, STATUS[v.status]) : []),
    ...(v.timestamp !== undefined ? protoNumber(5, v.timestamp) : []),
    ...(v.stopId !== undefined ? protoString(7, v.stopId) : []),
  ];
  return protoBytes(2, [...protoString(1, id), ...protoBytes(4, vehicle)]);
}

/** FeedMessage GTFS-RT 2.0 avec les véhicules donnés ; `feedTime` : heure de l'en-tête, en secondes Unix. */
export function encodeVehiclePositions(vehicles: GtfsRtVehicle[], feedTime: number): Uint8Array<ArrayBuffer> {
  const header = protoBytes(1, [...protoString(1, '2.0'), ...protoNumber(3, feedTime)]);
  return new Uint8Array([...header, ...vehicles.flatMap((v, i) => vehicleEntity(`v${i + 1}`, v))]);
}
