// Lecture minimale des flux GTFS-RT (protobuf), sans dépendance : seuls les champs utiles sont décodés. Alertes
// (perturbations) et positions des véhicules (carte en route, chantier « Prochain trajet », version 4).
// Spécification : https://gtfs.org/realtime/reference/ (FeedMessage › FeedEntity › Alert, VehiclePosition).

/** Valeur d'un champ : varint (bigint), longueur (octets) ou 32 bits lus comme un `float` (number) ; 64 bits sautés. */
type Field = { no: number; value: bigint | Uint8Array | number };

/** Champs d'un message protobuf, dans l'ordre (varint, longueur, 32 bits ; les 64 bits sont sautés). */
export function protoFields(buf: Uint8Array): Field[] {
  const fields: Field[] = [];
  let i = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= buf.length) throw new Error('protobuf tronqué');
      const byte = buf[i++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
  };
  while (i < buf.length) {
    const key = Number(varint());
    const no = key >>> 3;
    switch (key & 7) {
      case 0:
        fields.push({ no, value: varint() });
        break;
      case 1:
        i += 8;
        break;
      case 2: {
        const length = Number(varint());
        if (i + length > buf.length) throw new Error('protobuf tronqué');
        fields.push({ no, value: buf.subarray(i, i + length) });
        i += length;
        break;
      }
      case 5:
        if (i + 4 > buf.length) throw new Error('protobuf tronqué');
        fields.push({ no, value: new DataView(buf.buffer, buf.byteOffset + i, 4).getFloat32(0, true) });
        i += 4;
        break;
      default:
        throw new Error(`protobuf : type de champ ${key & 7} inconnu`);
    }
  }
  return fields;
}

const decoder = new TextDecoder();
const bytes = (fields: Field[], no: number) =>
  fields.filter((f) => f.no === no && f.value instanceof Uint8Array).map((f) => f.value as Uint8Array);
const number = (fields: Field[], no: number) => {
  const field = fields.find((f) => f.no === no && typeof f.value === 'bigint');
  return field ? Number(field.value) : undefined;
};

const float = (fields: Field[], no: number) => {
  const field = fields.find((f) => f.no === no && typeof f.value === 'number');
  return field && Number.isFinite(field.value) ? (field.value as number) : undefined;
};
const text = (fields: Field[], no: number) => {
  const [value] = bytes(fields, no);
  return value ? decoder.decode(value) : undefined;
};

/** TranslatedString : le texte en français s'il existe, sinon le premier. */
function translated(buf: Uint8Array | undefined): string | undefined {
  if (!buf) return undefined;
  const translations = bytes(protoFields(buf), 1).map((t) => {
    const f = protoFields(t);
    const [text] = bytes(f, 1);
    const [language] = bytes(f, 2);
    return { text: text ? decoder.decode(text) : '', language: language ? decoder.decode(language) : '' };
  });
  return (translations.find((t) => t.language.startsWith('fr')) ?? translations[0])?.text.trim() || undefined;
}

export type GtfsRtAlert = {
  id: string;
  routes: string[];
  /** Périodes d'effet, en secondes Unix ; vide : toujours. */
  periods: { start?: number; end?: number }[];
  header?: string;
  description?: string;
  url?: string;
};

/** Alertes d'un FeedMessage GTFS-RT. */
export function parseAlerts(buf: Uint8Array): GtfsRtAlert[] {
  const alerts: GtfsRtAlert[] = [];
  for (const entity of bytes(protoFields(buf), 2)) {
    const e = protoFields(entity);
    const [alertBytes] = bytes(e, 5);
    if (!alertBytes) continue;
    const a = protoFields(alertBytes);
    const [id] = bytes(e, 1);
    const routes = bytes(a, 5)
      .map((selector) => bytes(protoFields(selector), 2)[0])
      .filter((route) => route !== undefined)
      .map((route) => decoder.decode(route));
    alerts.push({
      id: id ? decoder.decode(id) : String(alerts.length),
      routes: [...new Set(routes)],
      periods: bytes(a, 1).map((p) => {
        const f = protoFields(p);
        return { start: number(f, 1), end: number(f, 2) };
      }),
      header: translated(bytes(a, 10)[0]),
      description: translated(bytes(a, 11)[0]),
      url: translated(bytes(a, 8)[0]),
    });
  }
  return alerts;
}

/** État du véhicule par rapport à l'arrêt `stopId` : en approche, à l'arrêt, ou en route vers lui (valeur par défaut). */
export type VehicleStatus = 'incoming' | 'stopped' | 'in-transit';
const STATUS: VehicleStatus[] = ['incoming', 'stopped', 'in-transit'];

/** Position d'un véhicule, rattachée à sa course (`trip_id` du GTFS). */
export type GtfsRtVehicle = {
  tripId: string;
  lat: number;
  lon: number;
  /** Cap en degrés (0 : nord, sens horaire), si le flux le donne. */
  bearing?: number;
  /** Heure de la position, en secondes Unix ; sinon celle de l'en-tête du flux. */
  timestamp?: number;
  /** Arrêt courant ou suivant (`stop_id` du GTFS) et son rang dans la course. */
  stopId?: string;
  stopSequence?: number;
  status?: VehicleStatus;
};

/** Positions des véhicules d'un FeedMessage GTFS-RT : seulement celles qui ont une course et une position. */
export function parseVehiclePositions(buf: Uint8Array): GtfsRtVehicle[] {
  const feed = protoFields(buf);
  const [header] = bytes(feed, 1);
  const feedTime = header ? number(protoFields(header), 3) : undefined;
  const vehicles: GtfsRtVehicle[] = [];
  for (const entity of bytes(feed, 2)) {
    const [vehicleBytes] = bytes(protoFields(entity), 4);
    if (!vehicleBytes) continue;
    const v = protoFields(vehicleBytes);
    const [trip] = bytes(v, 1);
    const [position] = bytes(v, 2);
    const tripId = trip ? text(protoFields(trip), 1) : undefined;
    if (!tripId || !position) continue;
    const p = protoFields(position);
    const lat = float(p, 1);
    const lon = float(p, 2);
    if (lat === undefined || lon === undefined || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const bearing = float(p, 3);
    const timestamp = number(v, 5) || feedTime;
    const stopId = text(v, 7);
    const stopSequence = number(v, 3);
    const status = number(v, 4);
    vehicles.push({
      tripId,
      lat,
      lon,
      ...(bearing !== undefined && { bearing }),
      ...(timestamp && { timestamp }),
      ...(stopId && { stopId }),
      ...(stopSequence !== undefined && { stopSequence }),
      ...(stopId && { status: STATUS[status ?? 2] ?? 'in-transit' }),
    });
  }
  return vehicles;
}
