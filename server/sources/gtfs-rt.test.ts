// Tests du décodeur GTFS-RT : champs protobuf (varint, longueur, 32 bits, champs ignorés), alertes (langue, périodes,
// lignes) et positions des véhicules (fixture binaire fictive, aller-retour avec l'encodeur des tests).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodeVehiclePositions } from './gtfs-rt-encode.ts';
import { parseAlerts, parseVehiclePositions, protoFields } from './gtfs-rt.ts';

// Encodeur protobuf minimal, pour fabriquer des messages de test.
const varint = (n: number) => {
  const out: number[] = [];
  do {
    out.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0));
    n = Math.floor(n / 128);
  } while (n > 0);
  return out;
};
const len = (no: number, body: number[]) => [...varint((no << 3) | 2), ...varint(body.length), ...body];
const str = (no: number, s: string) => len(no, [...new TextEncoder().encode(s)]);
const num = (no: number, n: number) => [...varint(no << 3), ...varint(n)];
const fixed64 = (no: number) => [...varint((no << 3) | 1), 1, 2, 3, 4, 5, 6, 7, 8];
const fixed32 = (no: number) => [...varint((no << 3) | 5), 1, 2, 3, 4];
const translation = (text: string, language?: string) => len(1, [...str(1, text), ...(language ? str(2, language) : [])]);

describe('protoFields', () => {
  it('lit les varints (même grands), les champs à longueur et les 32 bits (float), et saute les 64 bits', () => {
    const fields = protoFields(new Uint8Array([...num(1, 1_800_000_000), ...fixed64(2), ...str(3, 'é'), ...fixed32(4), ...num(5, 0)]));
    expect(fields.map((f) => f.no)).toEqual([1, 3, 4, 5]);
    expect(fields[0]?.value).toBe(1_800_000_000n);
    expect(new TextDecoder().decode(fields[1]?.value as Uint8Array)).toBe('é');
    expect(typeof fields[2]?.value).toBe('number');
  });

  it('refuse un message tronqué ou un type de champ inconnu', () => {
    expect(() => protoFields(new Uint8Array([...varint((1 << 3) | 2), 10, 1]))).toThrow('protobuf tronqué');
    expect(() => protoFields(new Uint8Array([0x80]))).toThrow('protobuf tronqué');
    expect(() => protoFields(new Uint8Array([(1 << 3) | 3]))).toThrow('type de champ 3 inconnu');
    expect(() => protoFields(new Uint8Array([(1 << 3) | 5, 1, 2]))).toThrow('protobuf tronqué');
  });
});

describe('parseAlerts', () => {
  const entity = (body: number[]) => len(2, body);

  it('préfère le texte en français, sinon le premier ; périodes ouvertes ; lignes sans doublon', () => {
    const feed = new Uint8Array([
      ...len(1, str(1, '2.0')),
      ...entity([
        ...str(1, 'grève'),
        ...len(5, [
          ...len(1, num(1, 1000)),
          ...len(5, str(2, '03')),
          ...len(5, str(2, '03')),
          ...len(5, str(1, 'agence')), // sélecteur sans ligne
          ...len(10, [...translation('Strike', 'en'), ...translation(' Grève ', 'fr-FR')]),
          ...len(11, translation('Pas de service')),
        ]),
      ]),
    ]);
    expect(parseAlerts(feed)).toEqual([
      { id: 'grève', routes: ['03'], periods: [{ start: 1000, end: undefined }], header: 'Grève', description: 'Pas de service', url: undefined },
    ]);
  });

  it('ignore les entités sans alerte, et numérote une alerte sans identifiant', () => {
    const feed = new Uint8Array([...entity(str(1, 'trip-update')), ...entity(len(5, len(10, translation('Travaux'))))]);
    expect(parseAlerts(feed)).toEqual([{ id: '0', routes: [], periods: [], header: 'Travaux', description: undefined, url: undefined }]);
  });
});

describe('parseVehiclePositions', () => {
  it('lit la fixture : course, position, cap, heure, arrêt et état ; ignore les entités sans course ou sans position', () => {
    const vehicles = parseVehiclePositions(new Uint8Array(readFileSync(new URL('./fixtures/vehicle-positions.pb', import.meta.url))));
    expect(vehicles.map((v) => v.tripId)).toEqual(['FICTIF-A-0712', 'FICTIF-3-0705', 'FICTIF-B-0720']);
    const [tram, bus, other] = vehicles;
    expect(tram).toMatchObject({ bearing: 315, timestamp: 1_792_999_980, stopId: 'JEXE', stopSequence: 5, status: 'stopped' });
    expect(tram.lat).toBeCloseTo(47.4765, 5);
    expect(tram.lon).toBeCloseTo(-0.5487, 5);
    // Sans état : en route vers l'arrêt (valeur par défaut du GTFS-RT).
    expect(bus).toMatchObject({ stopId: 'RIMA', status: 'in-transit', timestamp: 1_792_999_700 });
    expect(bus.bearing).toBeUndefined();
    // Sans heure ni arrêt : l'heure de l'en-tête du flux.
    expect(other).toMatchObject({ timestamp: 1_793_000_000 });
    expect(other.stopId).toBeUndefined();
    expect(other.status).toBeUndefined();
  });

  it('écarte une position nulle (0, 0) et rend un flux vide sans erreur', () => {
    expect(parseVehiclePositions(encodeVehiclePositions([{ tripId: 'X', lat: 0, lon: 0 }], 10))).toEqual([]);
    expect(parseVehiclePositions(new Uint8Array())).toEqual([]);
  });

  it('aller-retour avec l’encodeur', () => {
    const feed = encodeVehiclePositions([{ tripId: 'T1', lat: 47.47, lon: -0.55, timestamp: 1000, stopId: 'S1', status: 'incoming' }], 2000);
    expect(parseVehiclePositions(feed)).toEqual([{ tripId: 'T1', lat: expect.closeTo(47.47, 5), lon: expect.closeTo(-0.55, 5), timestamp: 1000, stopId: 'S1', status: 'incoming' }]);
  });
});
