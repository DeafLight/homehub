// Lecture minimale d'un flux GTFS-RT d'alertes (protobuf), sans dépendance : seuls les champs utiles sont décodés.
// Spécification : https://gtfs.org/realtime/reference/ (FeedMessage › FeedEntity › Alert).

type Field = { no: number; value: bigint | Uint8Array };

/** Champs d'un message protobuf, dans l'ordre (varint, 64 bits, longueur, 32 bits). */
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
