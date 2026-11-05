// Dashboard « focus » d'un élève (logique pure, testée) : une seule frise (aujourd'hui ou demain), une grande carte
// du moment, et le reste en tuiles qui s'ouvrent en panneau.
import type { DashboardData } from '../../../shared/types.ts';
import type { DayPlan } from './day.ts';
import { formatEventWhen } from './format.ts';
import { homeworkGroups } from './homework.ts';
import { routineName } from './routine.ts';

export type FocusCard = 'routine' | 'homework' | 'upcoming';
export type TileKind = FocusCard | 'tasks' | 'notes';
export type Tile = { kind: TileKind; value: string; label: string; highlight: boolean };

/** Après cette heure, les devoirs laissent la place à la routine du soir. */
export const HOMEWORK_UNTIL_HOUR = 19;
/** Sans cours aujourd'hui, la frise passe à demain à partir de midi. */
const TOMORROW_FROM_HOUR = 12;

/** Devoirs pas encore faits du prochain jour qui en a (aujourd'hui exclu l'après-midi, comme la carte). */
export function nextHomework(data: Pick<DashboardData, 'homework'>, now: Date) {
  const group = homeworkGroups(data.homework ?? [], now).find((g) => g.left > 0);
  return group ?? null;
}

/**
 * Carte du moment : la routine du matin ; puis, après l'école, les devoirs qui restent (jusqu'à 19 h) ; puis la
 * routine du soir ; sinon les devoirs, sinon les prochains rendez-vous.
 */
export function focusCard(data: Pick<DashboardData, 'routine' | 'homework'>, now: Date): FocusCard {
  if (data.routine?.period === 'morning') return 'routine';
  const homework = nextHomework(data, now);
  if (homework && now.getHours() < HOMEWORK_UNTIL_HOUR) return 'homework';
  if (data.routine) return 'routine';
  if (homework) return 'homework';
  return 'upcoming';
}

/** Jour montré par la frise : demain une fois le dernier élément d'aujourd'hui terminé (ou l'après-midi sans rien). */
export function timelineDay(today: DayPlan, now: Date): 'today' | 'tomorrow' {
  const ends = today.items.filter((i) => !i.cancelled).map((i) => i.end.getTime());
  if (ends.length === 0) return now.getHours() >= TOMORROW_FROM_HOUR ? 'tomorrow' : 'today';
  return now.getTime() >= Math.max(...ends) ? 'tomorrow' : 'today';
}

/** Tuiles : tout ce qui n'est pas la carte du moment, avec un chiffre et un mot ; mises en avant si nouveau ou urgent. */
export function focusTiles(
  data: Pick<DashboardData, 'routine' | 'homework' | 'tasks' | 'notes' | 'events'>,
  now: Date,
  nameOf: (ownerId: string | null) => string | undefined,
): Tile[] {
  const focus = focusCard(data, now);
  const tiles: Tile[] = [];
  if (data.homework && focus !== 'homework') {
    const next = nextHomework(data, now);
    tiles.push(
      next
        ? { kind: 'homework', value: String(next.left), label: `devoir${next.left > 1 ? 's' : ''} ${next.title.toLowerCase()}`, highlight: next.title === 'Pour demain' }
        : { kind: 'homework', value: '✓', label: 'devoirs faits', highlight: false },
    );
  }
  if (data.routine && focus !== 'routine') {
    const done = data.routine.items.filter((i) => i.done).length;
    tiles.push({ kind: 'routine', value: `${done}/${data.routine.items.length}`, label: routineName(data.routine.period).toLowerCase(), highlight: false });
  }
  const pending = data.tasks.filter((t) => !t.done).length;
  tiles.push({ kind: 'tasks', value: pending ? String(pending) : '✓', label: pending > 1 ? 'tâches' : pending ? 'tâche' : 'rien à faire', highlight: false });
  const [note] = data.notes;
  const author = note && nameOf(note.from.ownerId);
  tiles.push(
    note
      ? { kind: 'notes', value: String(data.notes.length), label: data.notes.length > 1 ? 'mots' : author ? `mot de ${author}` : 'mot', highlight: true }
      : { kind: 'notes', value: '+', label: 'laisser un mot', highlight: false },
  );
  if (focus !== 'upcoming') {
    const event = data.events.find((e) => new Date(e.start) >= now);
    tiles.push(
      event
        ? { kind: 'upcoming', value: event.title, label: formatEventWhen(event, now).toLowerCase(), highlight: false }
        : { kind: 'upcoming', value: '—', label: 'rien de prévu', highlight: false },
    );
  }
  return tiles;
}
