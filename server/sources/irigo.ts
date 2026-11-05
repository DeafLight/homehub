// Bus et tram Irigo (Angers), par l'open data d'Angers Loire Métropole (licence ODbL, sans clé) :
// - prochains passages à un arrêt : API SIRI (SOAP) d'Ara, StopMonitoring, avec RequestorRef « opendata » ;
// - perturbations : flux GTFS-RT d'alertes.
// SIRI ne connaît que les courses proches (environ l'heure qui vient) : la nuit, un arrêt n'a aucun passage.
import { randomUUID } from 'node:crypto';
import type { Departure, TransitAlert } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import { parseAlerts } from './gtfs-rt.ts';
import { createRefreshingCache } from './refreshing-cache.ts';
import type { SourceStatus } from './source-status.ts';
import type { Clock } from './types.ts';

export const SIRI_URL = 'https://ara-api.enroute.mobi/irigo/siri';
export const ALERTS_URL = 'https://notify.ratpdev.com/api/networks/RD%20ANGERS/alerts/gtfsrt';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_VISITS = 12;
/** Passages servis encore 10 min en cas de panne (ils sont filtrés sur l'heure à la lecture). */
const DEPARTURES_STALE_MS = 10 * 60_000;
const ALERTS_REFRESH_MS = 10 * 60_000;
const ALERTS_STALE_MS = 6 * 3_600_000;

/** « 03 » → « 3 » ; « A » reste « A ». Les lignes du flux d'alertes et de SIRI se comparent ainsi. */
export const lineLabel = (ref: string) => ref.trim().replace(/^0+(?=\w)/u, '');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code] ?? match;
  });

/** Contenus des éléments `<siri:tag>` (préfixe d'espace de noms quelconque, ou aucun). */
export function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'gu');
  return [...xml.matchAll(re)].map((m) => m[1]);
}
/** Texte du premier élément `tag`, ou undefined. */
export const xmlText = (xml: string, tag: string): string | undefined => {
  const [value] = xmlBlocks(xml, tag);
  return value === undefined ? undefined : decodeXml(value.trim());
};

function envelope(operation: string, request: string): string {
  const now = new Date().toISOString();
  const id = `homehub-${randomUUID()}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">
<S:Body><sw:${operation}>${request
    .replaceAll('{now}', now)
    .replaceAll('{id}', id)}<RequestExtension/></sw:${operation}></S:Body></S:Envelope>`;
}

const header = '<siri:RequestTimestamp>{now}</siri:RequestTimestamp><siri:RequestorRef>opendata</siri:RequestorRef><siri:MessageIdentifier>{id}</siri:MessageIdentifier>';

/** « Verneau - voie 2 » → « Verneau ». */
const cleanDestination = (name: string) => name.replace(/\s*-\s*voie\s*\d+\s*$/iu, '').trim();

/** Passages d'une réponse StopMonitoring, triés ; le nom de l'arrêt s'il y figure. */
export function parseStopMonitoring(xml: string): { name?: string; departures: Departure[] } {
  if (xmlText(xml, 'Status') === 'false') {
    throw new Error(`SIRI : ${xmlText(xml, 'ErrorText') ?? xmlText(xml, 'Description') ?? 'requête refusée'}`);
  }
  let name: string | undefined;
  const departures: Departure[] = [];
  for (const visit of xmlBlocks(xml, 'MonitoredStopVisit')) {
    const journey = xmlBlocks(visit, 'MonitoredVehicleJourney')[0] ?? visit;
    const call = xmlBlocks(journey, 'MonitoredCall')[0] ?? journey;
    const line = xmlText(journey, 'LineRef');
    const expected = xmlText(call, 'ExpectedDepartureTime') ?? xmlText(call, 'ExpectedArrivalTime');
    const aimed = xmlText(call, 'AimedDepartureTime') ?? xmlText(call, 'AimedArrivalTime');
    const at = expected ?? aimed;
    if (!line || !at || Number.isNaN(Date.parse(at))) continue;
    name ??= xmlText(call, 'StopPointName');
    const status = `${xmlText(call, 'DepartureStatus') ?? ''} ${xmlText(call, 'ArrivalStatus') ?? ''}`;
    departures.push({
      line: lineLabel(line),
      destination: cleanDestination(xmlText(journey, 'DestinationName') ?? xmlText(call, 'DestinationDisplay') ?? ''),
      at: new Date(at).toISOString(),
      realtime: expected !== undefined,
      ...(/cancelled/iu.test(status) && { cancelled: true }),
    });
  }
  departures.sort((a, b) => a.at.localeCompare(b.at));
  return { name, departures };
}

export type StopPoint = { id: string; name: string; lines: string[] };

/** Arrêts d'une réponse StopPointsDiscovery. */
export function parseStopPoints(xml: string): StopPoint[] {
  return xmlBlocks(xml, 'AnnotatedStopPointRef').map((stop) => ({
    id: xmlText(stop, 'StopPointRef') ?? '',
    name: xmlText(stop, 'StopName') ?? '',
    lines: xmlBlocks(stop, 'LineRef').map((l) => lineLabel(decodeXml(l))),
  }));
}

export function createIrigoClient(fetchFn: typeof fetch = (...args) => fetch(...args)) {
  async function siri(operation: string, request: string): Promise<string> {
    const res = await fetchFn(SIRI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: envelope(operation, request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`SIRI : HTTP ${res.status}`);
    return text;
  }

  return {
    async stopDepartures(stopId: string) {
      return parseStopMonitoring(
        await siri(
          'GetStopMonitoring',
          `<ServiceRequestInfo>${header}</ServiceRequestInfo><Request version="2.0:FR-IDF-2.4"><siri:RequestTimestamp>{now}</siri:RequestTimestamp><siri:MessageIdentifier>{id}</siri:MessageIdentifier><siri:MonitoringRef>${stopId}</siri:MonitoringRef><siri:MaximumStopVisits>${MAX_VISITS}</siri:MaximumStopVisits></Request>`,
        ),
      );
    },
    async stopPoints(): Promise<StopPoint[]> {
      return parseStopPoints(await siri('StopPointsDiscovery', `<Request>${header}</Request>`));
    },
    async alerts() {
      const res = await fetchFn(ALERTS_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`alertes : HTTP ${res.status}`);
      return parseAlerts(new Uint8Array(await res.arrayBuffer()));
    },
  };
}

export type IrigoClient = ReturnType<typeof createIrigoClient>;

export interface TransitSource {
  /** Passages à venir à l'arrêt (y compris ceux de la minute écoulée), triés ; nom de l'arrêt si connu. */
  departures(stopId: string): Promise<{ name?: string; departures: Departure[] }>;
  /** Perturbations en cours, sur les lignes données (toutes si absent). */
  alerts(lines?: string[]): Promise<TransitAlert[]>;
}

export type TransitSourceDeps = {
  client: IrigoClient;
  refreshSeconds: () => number;
  clock: Clock;
  logger: Logger;
  status?: SourceStatus;
};

export function createTransitSource({ client, refreshSeconds, clock, logger, status }: TransitSourceDeps): TransitSource {
  const stops = createRefreshingCache({
    clock,
    logger,
    status,
    staleMaxMs: DEPARTURES_STALE_MS,
    retryDelayMs: 30_000,
    load: (stopId) => client.stopDepartures(stopId),
  });
  const alerts = createRefreshingCache({ clock, logger, status, staleMaxMs: ALERTS_STALE_MS, load: () => client.alerts() });

  return {
    async departures(stopId) {
      const data = await stops.get(stopId, refreshSeconds() * 1000, 'Irigo');
      const from = clock().getTime() - 60_000;
      return { name: data.name, departures: data.departures.filter((d) => Date.parse(d.at) >= from) };
    },
    async alerts(lines) {
      const now = clock().getTime() / 1000;
      const wanted = lines && new Set(lines.map(lineLabel));
      return (await alerts.get('alerts', ALERTS_REFRESH_MS, 'Irigo (perturbations)'))
        .filter((a) => a.periods.length === 0 || a.periods.some((p) => (p.start ?? 0) <= now && now < (p.end ?? Infinity)))
        .map((a) => ({ ...a, routes: a.routes.map(lineLabel) }))
        .filter((a) => !wanted || a.routes.some((r) => wanted.has(r)))
        .map((a) => ({
          id: a.id,
          lines: wanted ? a.routes.filter((r) => wanted.has(r)) : a.routes,
          title: a.header ?? a.description?.split('\n')[0] ?? 'Perturbation',
          ...(a.url && { url: a.url }),
        }));
    },
  };
}
