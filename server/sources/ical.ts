// Agendas au format iCal : l'« adresse secrète au format iCal » de Google Agenda (ou de tout autre agenda).
// Lecture seule. Les adresses sont des secrets : elles viennent de l'environnement et n'apparaissent jamais dans
// les logs, où l'agenda est désigné par le nom de sa variable.
import ICAL from 'ical.js';
import type { CalendarEvent } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import { createRefreshingCache } from './refreshing-cache.ts';
import type { SourceStatus } from './source-status.ts';
import type { AgendaSource, Clock, TimeRange } from './types.ts';

const REQUEST_TIMEOUT_MS = 15_000;
/** En cas de panne, les agendas restent affichés tant qu'ils ont moins de 24 h. */
const STALE_MAX_MS = 24 * 3_600_000;
/** Garde-fou contre une règle de récurrence sans fin : une occurrence par jour depuis plus de 50 ans. */
const MAX_OCCURRENCES = 20_000;

type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalTime = InstanceType<typeof ICAL.Time>;

export type IcalAgendaDeps = {
  /** Noms des variables qui contiennent les adresses des agendas du profil. Lu à chaque appel (config à chaud). */
  calendarsFor(ownerId: string): string[];
  refreshMinutes(): number;
  /** Résout un nom de variable en adresse secrète (process.env en production). */
  secret(name: string): string | undefined;
  clock: Clock;
  logger: Logger;
  /** Résultat de chaque chargement, pour la page « Le NAS ». */
  status?: SourceStatus;
  fetch?: typeof fetch;
};

/** Lit un fichier iCal : événements maîtres, auxquels sont rattachées leurs occurrences modifiées. */
export function parseCalendar(text: string): IcalEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  // Les fuseaux du fichier (VTIMEZONE) doivent être connus avant de lire les dates des événements.
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    const tzid = zone.getFirstPropertyValue('tzid');
    if (typeof tzid === 'string' && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(zone);
  }

  const masters = new Map<string, IcalEvent>();
  const exceptions: IcalEvent[] = [];
  for (const component of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component);
    if (event.isRecurrenceException()) exceptions.push(event);
    else masters.set(event.uid, event);
  }
  const orphans: IcalEvent[] = [];
  for (const exception of exceptions) {
    const master = masters.get(exception.uid);
    if (master) master.relateException(exception);
    else orphans.push(exception);
  }
  return [...masters.values(), ...orphans];
}

/** Vrai si l'événement déborde sur un autre jour que celui où il commence (heure locale du serveur). */
function spansSeveralDays(start: Date, end: Date): boolean {
  const lastMoment = new Date(end.getTime() - 1);
  return lastMoment.toDateString() !== start.toDateString();
}

/** Occurrences visibles dans l'intervalle (voir AgendaSource.eventsFor), récurrences déroulées. */
export function occurrencesIn(events: IcalEvent[], range: TimeRange): CalendarEvent[] {
  const result: CalendarEvent[] = [];

  const add = (item: IcalEvent, start: IcalTime, end: IcalTime) => {
    if (item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const startDate = start.toJSDate();
    const endDate = end.toJSDate();
    const visible =
      start.isDate || spansSeveralDays(startDate, endDate)
        ? endDate > range.from && startDate < range.to
        : startDate >= range.from && startDate < range.to;
    if (!visible) return;
    result.push({
      id: `${item.uid}/${start.toString()}`,
      title: item.summary || '(sans titre)',
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      ...(start.isDate && { allDay: true }),
      ...(item.location && { location: item.location }),
    });
  };

  for (const event of events) {
    if (!event.isRecurring()) {
      add(event, event.startDate, event.endDate);
      continue;
    }
    const iterator = event.iterator();
    for (let i = 0, next = iterator.next(); next && i < MAX_OCCURRENCES; i++, next = iterator.next()) {
      if (next.toJSDate() >= range.to) break;
      const { item, startDate, endDate } = event.getOccurrenceDetails(next);
      add(item, startDate, endDate);
    }
  }
  return result;
}

export function createIcalAgendaSource({
  calendarsFor,
  refreshMinutes,
  secret,
  clock,
  logger,
  status,
  fetch: fetchFn = (...args) => fetch(...args),
}: IcalAgendaDeps): AgendaSource {
  const cache = createRefreshingCache<IcalEvent[]>({
    clock,
    logger,
    status,
    staleMaxMs: STALE_MAX_MS,
    async load(url) {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseCalendar(await res.text());
    },
  });
  const warned = new Set<string>();

  async function eventsOf(name: string, range: TimeRange): Promise<CalendarEvent[]> {
    const url = secret(name);
    if (!url) {
      if (!warned.has(name)) logger.error(`Agenda ${name} : variable d'environnement absente (voir app.env).`);
      warned.add(name);
      return [];
    }
    try {
      return occurrencesIn(await cache.get(url, refreshMinutes() * 60_000, `Agenda ${name}`), range);
    } catch {
      return []; // déjà journalisé par le cache ; les autres agendas restent affichés
    }
  }

  return {
    async eventsFor(ownerId, range) {
      const lists = await Promise.all(calendarsFor(ownerId).map((name) => eventsOf(name, range)));
      // Un événement présent dans deux agendas du même profil n'est affiché qu'une fois.
      const unique = new Map(lists.flat().map((e) => [e.id, e]));
      return [...unique.values()].sort((a, b) => a.start.localeCompare(b.start));
    },
  };
}
