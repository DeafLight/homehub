import { describe, expect, it } from 'vitest';
import { NOW, silentLogger } from '../testing.ts';
import { parseAlerts } from './gtfs-rt.ts';
import { createIrigoClient, createTransitSource, lineLabel, parseStopMonitoring, parseStopPoints, xmlText } from './irigo.ts';

// Encodeur protobuf minimal, pour fabriquer un flux GTFS-RT de test.
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
const translated = (no: number, text: string) => len(no, len(1, [...str(1, text), ...str(2, 'fr')]));
const alert = (id: string, routes: string[], header: string, period?: [number, number]) =>
  len(2, [
    ...str(1, id),
    ...len(5, [
      ...(period ? len(1, [...num(1, period[0]), ...num(2, period[1])]) : []),
      ...routes.flatMap((r) => len(5, str(2, r))),
      ...translated(8, `https://irigo.example/${id}`),
      ...translated(10, header),
    ]),
  ]);
const nowS = NOW.getTime() / 1000;
const FEED = new Uint8Array([
  ...len(1, str(1, '2.0')),
  ...alert('a1', ['03', 'A'], 'Ligne 3 déviée', [nowS - 3600, nowS + 3600]),
  ...alert('a2', ['08'], 'Ligne 8 déviée le 09/11', [nowS + 86_400, nowS + 2 * 86_400]),
  ...alert('a3', ['03'], 'Grève'),
]);

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const visit = (line: string, destination: string, aimed: number, expected?: number, status = 'onTime') => `
  <siri:MonitoredStopVisit>
    <siri:MonitoringRef>1MAIR</siri:MonitoringRef>
    <siri:MonitoredVehicleJourney>
      <siri:LineRef>${line}</siri:LineRef>
      <siri:DestinationName>${destination}</siri:DestinationName>
      <siri:MonitoredCall>
        <siri:StopPointRef>1MAIR</siri:StopPointRef>
        <siri:StopPointName>Mairie &amp; Parc</siri:StopPointName>
        <siri:AimedDepartureTime>${at(aimed)}</siri:AimedDepartureTime>
        ${expected === undefined ? '' : `<siri:ExpectedDepartureTime>${at(expected)}</siri:ExpectedDepartureTime>`}
        <siri:DepartureStatus>${status}</siri:DepartureStatus>
      </siri:MonitoredCall>
    </siri:MonitoredVehicleJourney>
  </siri:MonitoredStopVisit>`;
const response = (visits: string) => `<?xml version='1.0' encoding='utf-8'?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>
<sw:GetStopMonitoringResponse xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri"><Answer>
<siri:StopMonitoringDelivery version="2.0:FR-IDF-2.4"><siri:Status>true</siri:Status><siri:MonitoringRef>1MAIR</siri:MonitoringRef>
${visits}
</siri:StopMonitoringDelivery></Answer></sw:GetStopMonitoringResponse></S:Body></S:Envelope>`;
const VISITS = response(
  visit('03', 'Centre-ville', 9, 10) + visit('03', 'Centre-ville', -5, -4) + visit('A', 'Verneau - voie 2', 2) + visit('03', 'Lycée', 4, 5, 'cancelled'),
);

describe('SIRI', () => {
  it('lit les passages : ligne, destination, heure prévue ou théorique, suppression ; triés', () => {
    const { name, departures } = parseStopMonitoring(VISITS);
    expect(name).toBe('Mairie & Parc');
    expect(departures).toEqual([
      { line: '3', destination: 'Centre-ville', at: at(-4), realtime: true },
      { line: 'A', destination: 'Verneau', at: at(2), realtime: false },
      { line: '3', destination: 'Lycée', at: at(5), realtime: true, cancelled: true },
      { line: '3', destination: 'Centre-ville', at: at(10), realtime: true },
    ]);
  });

  it('signale une requête refusée', () => {
    expect(() => parseStopMonitoring('<siri:Status>false</siri:Status><siri:ErrorText>Arrêt inconnu</siri:ErrorText>')).toThrow(
      'Arrêt inconnu',
    );
  });

  it('lit les arrêts, et normalise les lignes', () => {
    const xml = `<siri:AnnotatedStopPointRef><siri:StopPointRef>1ANRO</siri:StopPointRef><siri:StopName>Roseraie</siri:StopName>
      <siri:Lines><siri:LineRef>A</siri:LineRef><siri:LineRef>05</siri:LineRef></siri:Lines></siri:AnnotatedStopPointRef>`;
    expect(parseStopPoints(xml)).toEqual([{ id: '1ANRO', name: 'Roseraie', lines: ['A', '5'] }]);
    expect(lineLabel('03')).toBe('3');
    expect(lineLabel('10')).toBe('10');
    expect(lineLabel('N1')).toBe('N1');
    expect(xmlText('<a:b>x &lt; y &#233;</a:b>', 'b')).toBe('x < y é');
  });

  it('interroge Ara en SOAP, comme « opendata », pour l’arrêt demandé', async () => {
    const bodies: string[] = [];
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(VISITS);
    }) as unknown as typeof fetch;
    const result = await createIrigoClient(fetchFn).stopDepartures('1MAIR');
    expect(result.departures).toHaveLength(4);
    expect(bodies[0]).toContain('<siri:RequestorRef>opendata</siri:RequestorRef>');
    expect(bodies[0]).toContain('<siri:MonitoringRef>1MAIR</siri:MonitoringRef>');
  });
});

describe('alertes GTFS-RT', () => {
  it('décode les alertes : lignes, périodes, titre et lien', () => {
    expect(parseAlerts(FEED)[0]).toEqual({
      id: 'a1',
      routes: ['03', 'A'],
      periods: [{ start: nowS - 3600, end: nowS + 3600 }],
      header: 'Ligne 3 déviée',
      description: undefined,
      url: 'https://irigo.example/a1',
    });
  });
});

describe('createTransitSource', () => {
  function setup() {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return url.includes('gtfsrt') ? new Response(FEED) : new Response(VISITS);
    }) as unknown as typeof fetch;
    const source = createTransitSource({ client: createIrigoClient(fetchFn), refreshSeconds: () => 60, clock: () => NOW, logger: silentLogger() });
    return { source, calls };
  }

  it('garde les passages de la minute écoulée et après, et met l’arrêt en cache', async () => {
    const { source, calls } = setup();
    expect((await source.departures('1MAIR')).departures.map((d) => d.at)).toEqual([at(2), at(5), at(10)]);
    await source.departures('1MAIR');
    expect(calls).toHaveLength(1);
  });

  it('donne les perturbations en cours sur les lignes demandées', async () => {
    const { source } = setup();
    expect(await source.alerts(['3'])).toEqual([
      { id: 'a1', lines: ['3'], title: 'Ligne 3 déviée', url: 'https://irigo.example/a1' },
      { id: 'a3', lines: ['3'], title: 'Grève', url: 'https://irigo.example/a3' },
    ]);
    expect(await source.alerts(['8'])).toEqual([]); // la déviation du 09/11 n'a pas commencé
  });
});
