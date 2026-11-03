// Grille de la semaine : les agendas et les cours des profils choisis, jour par jour, prêts à placer.
import type { CalendarEvent, WeekData } from '../../../shared/types.ts';
import { addDays, eventsOnDay, fitsInDay, whenOnDay } from './day.ts';
import { formatTime } from './format.ts';

/** Plage affichée par défaut ; élargie si un élément en déborde. */
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 21;
const DEFAULT_EVENT_MINUTES = 60;

export type WeekBlock = {
  id: string;
  ownerId: string;
  kind: 'event' | 'course';
  title: string;
  /** Heure de début. */
  meta: string;
  /** Salle d'un cours. */
  detail?: string;
  cancelled: boolean;
  start: Date;
  end: Date;
  /** Couloir dans le groupe d'éléments qui se chevauchent, et nombre de couloirs de ce groupe. */
  lane: number;
  lanes: number;
};

export type WeekAllDay = { id: string; ownerId: string; title: string; meta: string };

export type WeekDay = { date: Date; allDay: WeekAllDay[]; blocks: WeekBlock[] };

export type WeekFilter = {
  /** Profils affichés. */
  owners: ReadonlySet<string>;
  /** Cours affichés, chacun dans son bloc comme un événement. */
  courses: boolean;
};

const endOf = (event: CalendarEvent) =>
  event.end ? new Date(event.end) : new Date(new Date(event.start).getTime() + DEFAULT_EVENT_MINUTES * 60_000);

/** Répartit en couloirs les éléments qui se chevauchent ; un groupe sans chevauchement garde toute la largeur. */
function assignLanes(blocks: Omit<WeekBlock, 'lane' | 'lanes'>[]): WeekBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  const result: WeekBlock[] = [];
  let group: WeekBlock[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const closeGroup = () => {
    for (const block of group) block.lanes = laneEnds.length;
    result.push(...group);
    group = [];
    laneEnds = [];
  };
  for (const block of sorted) {
    if (block.start.getTime() >= groupEnd) closeGroup();
    let lane = laneEnds.findIndex((end) => end <= block.start.getTime());
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = block.end.getTime();
    groupEnd = Math.max(groupEnd, block.end.getTime());
    group.push({ ...block, lane, lanes: 0 });
  }
  closeGroup();
  return result;
}

/** Les 7 jours de la semaine, avec les éléments des profils retenus (dans l'ordre des profils de `data`). */
export function weekDays(data: WeekData, filter: WeekFilter): WeekDay[] {
  const monday = new Date(data.start);
  const owners = data.owners.filter((o) => filter.owners.has(o.ownerId));

  // Un même événement peut figurer dans deux agendas (le sien et celui de la famille) : affiché une fois,
  // au nom du premier profil (les membres passent avant la famille).
  const seen = new Set<string>();
  const events: { ownerId: string; event: CalendarEvent }[] = [];
  for (const { ownerId, events: list } of owners) {
    for (const event of list) {
      const key = `${event.id}|${event.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ownerId, event });
    }
  }

  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const next = addDays(date, 1);
    const onDay = new Set(eventsOnDay(events.map((e) => e.event), date));
    const todays = events.filter((e) => onDay.has(e.event));

    const blocks: Omit<WeekBlock, 'lane' | 'lanes'>[] = todays
      .filter(({ event }) => fitsInDay(event, date))
      .map(({ ownerId, event }) => ({
        id: `e-${ownerId}-${event.id}-${event.start}`,
        ownerId,
        kind: 'event',
        title: event.title,
        meta: formatTime(new Date(event.start)),
        cancelled: false,
        start: new Date(event.start),
        end: endOf(event),
      }));

    // Chaque cours a son bloc, comme un événement ; un cours annulé reste visible (barré).
    if (filter.courses) {
      for (const { ownerId, courses } of owners) {
        for (const course of courses ?? []) {
          const start = new Date(course.start);
          const end = new Date(course.end);
          if (start >= next || end <= date) continue;
          blocks.push({
            id: `c-${ownerId}-${course.id}`,
            ownerId,
            kind: 'course',
            title: course.subject,
            meta: formatTime(start),
            detail: course.room,
            cancelled: course.cancelled,
            start,
            end,
          });
        }
      }
    }

    return {
      date,
      allDay: todays
        .filter(({ event }) => !fitsInDay(event, date))
        .map(({ ownerId, event }) => ({
          id: `${ownerId}-${event.id}-${event.start}`,
          ownerId,
          title: event.title,
          meta: whenOnDay(event, date),
        })),
      blocks: assignLanes(blocks),
    };
  });
}

/** Plage horaire commune aux 7 colonnes : 8 h–21 h, élargie aux éléments qui en sortent. */
export function weekHours(days: WeekDay[]): { startHour: number; endHour: number } {
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const { blocks } of days) {
    for (const block of blocks) {
      startHour = Math.min(startHour, block.start.getHours());
      const endMinutes = block.end.getDate() !== block.start.getDate() ? 24 * 60 : block.end.getHours() * 60 + block.end.getMinutes();
      endHour = Math.max(endHour, Math.ceil(endMinutes / 60));
    }
  }
  return { startHour, endHour };
}

/** Profils affichés à l'ouverture : depuis un membre, lui et la famille ; depuis l'accueil ou la famille, tout le monde. */
export function initialOwners(allIds: string[], fromOwnerId: string | null, familyId: string): Set<string> {
  if (!fromOwnerId || fromOwnerId === familyId || !allIds.includes(fromOwnerId)) return new Set(allIds);
  return new Set([fromOwnerId, familyId]);
}

const dayMonthFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const weekdayShortFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

/** « Semaine du 2 au 8 novembre », « Semaine du 30 novembre au 6 décembre ». */
export function weekRangeLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const from = monday.getMonth() === sunday.getMonth() ? String(monday.getDate()) : dayMonthFormat.format(monday);
  return `Semaine du ${from} au ${dayMonthFormat.format(sunday)}`;
}

/** « lun », « mar »… */
export const weekdayShort = (date: Date) => weekdayShortFormat.format(date).replace('.', '');

/** Libellé de la semaine affichée par rapport à la semaine en cours. */
export const weekOffsetLabel = (offset: number) =>
  offset === 0 ? 'Cette semaine' : offset === 1 ? 'Semaine prochaine' : `Dans ${offset} semaines`;
