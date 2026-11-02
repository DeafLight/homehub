// Sources d'exemple, en mémoire : elles donnent à chaque profil des données plausibles, calculées par rapport
// à l'heure courante pour que l'écran ait l'air vivant. À remplacer source par source par les vraies.
import type { CalendarEvent, Note, Task, Weather } from '../../shared/types.ts';
import type { AgendaSource, Clock, NoteSource, Sources, TaskSource, WeatherSource } from './types.ts';

/** Événement type : jour relatif à aujourd'hui (0 = aujourd'hui) et heure locale. */
type EventTemplate = { day: number; hour: number; minute: number; title: string; location?: string };

const AGENDA_TEMPLATES: EventTemplate[][] = [
  [
    { day: 0, hour: 19, minute: 0, title: 'Réunion parents-profs', location: 'École' },
    { day: 1, hour: 8, minute: 30, title: 'Dentiste' },
    { day: 3, hour: 18, minute: 0, title: 'Sport' },
  ],
  [
    { day: 2, hour: 12, minute: 30, title: 'Déjeuner avec des amis' },
    { day: 4, hour: 9, minute: 0, title: 'Contrôle technique' },
  ],
  [
    { day: 1, hour: 17, minute: 30, title: 'Piscine', location: 'Centre aquatique' },
    { day: 3, hour: 10, minute: 0, title: 'Contrôle de français' },
    { day: 5, hour: 15, minute: 0, title: 'Anniversaire d’un copain' },
  ],
  [
    { day: 0, hour: 18, minute: 15, title: 'Entraînement de foot' },
    { day: 2, hour: 14, minute: 0, title: 'Atelier dessin' },
  ],
];

const FAMILY_TEMPLATE: EventTemplate[] = [
  { day: 0, hour: 20, minute: 0, title: 'Dîner en famille' },
  { day: 5, hour: 11, minute: 0, title: 'Marché' },
];

const TASK_TEMPLATES: string[][] = [
  ['Sortir les poubelles', 'Payer la cantine', 'Rappeler le garagiste'],
  ['Arroser les plantes', 'Ranger le garage'],
  ['Devoirs', 'Préparer le cartable', 'Douche', 'Lecture 15 min'],
  ['Devoirs', 'Ranger sa chambre', 'Mettre la table'],
];

const FAMILY_TASKS = ['Lait', 'Pain', 'Pommes', 'Liquide vaisselle'];

const NOTES = ['Bravo pour ta note de maths !', 'N’oublie pas ton goûter demain.', 'Bonne journée !'];

/** `memberIds` : les membres dans l'ordre de la config ; chacun reçoit un jeu d'exemples différent. */
export function createSampleSources(memberIds: () => string[], familyId: string, clock: Clock): Sources {
  const indexOf = (ownerId: string) => Math.max(0, memberIds().indexOf(ownerId));
  const templateFor = <T>(ownerId: string, perMember: T[], family: T): T =>
    ownerId === familyId ? family : perMember[indexOf(ownerId) % perMember.length];

  const agenda: AgendaSource = {
    async eventsFor(ownerId, range) {
      const today = clock();
      today.setHours(0, 0, 0, 0);
      return templateFor(ownerId, AGENDA_TEMPLATES, FAMILY_TEMPLATE)
        .map((t, i): CalendarEvent => {
          const start = new Date(today);
          start.setDate(start.getDate() + t.day);
          start.setHours(t.hour, t.minute);
          return { id: `${ownerId}-${i}`, title: t.title, start: start.toISOString(), location: t.location };
        })
        .filter((e) => {
          const start = new Date(e.start);
          return start >= range.from && start < range.to;
        })
        .sort((a, b) => a.start.localeCompare(b.start));
    },
  };

  // Les tâches cochées sont gardées en mémoire jusqu'au redémarrage.
  const taskLists = new Map<string, Task[]>();
  const listFor = (ownerId: string): Task[] => {
    let list = taskLists.get(ownerId);
    if (!list) {
      list = templateFor(ownerId, TASK_TEMPLATES, FAMILY_TASKS).map((label, i) => ({
        id: `${ownerId}-t${i}`,
        label,
        done: false,
      }));
      taskLists.set(ownerId, list);
    }
    return list;
  };

  const tasks: TaskSource = {
    async tasksFor(ownerId) {
      return listFor(ownerId).map((t) => ({ ...t }));
    },
    async setDone(ownerId, taskId, done) {
      const task = listFor(ownerId).find((t) => t.id === taskId);
      if (!task) return null;
      task.done = done;
      return { ...task };
    },
  };

  const notes: NoteSource = {
    async latestFor(ownerId) {
      const ids = memberIds();
      if (ids.length < 2) return null;
      const index = indexOf(ownerId);
      const note: Note = { text: NOTES[index % NOTES.length], authorId: ids[(index + 1) % ids.length] };
      return note;
    },
  };

  const weather: WeatherSource = {
    async current(): Promise<Weather> {
      const rain = clock();
      rain.setMinutes(0, 0, 0);
      rain.setHours(rain.getHours() + 3);
      return {
        location: 'Exemple',
        temperatureC: 12,
        weatherCode: 2,
        isDay: true,
        today: { minC: 6, maxC: 15 },
        tomorrow: { minC: 5, maxC: 13, weatherCode: 61 },
        rainStartsAt: rain.toISOString(),
      };
    },
  };

  return { agenda, tasks, notes, weather };
}
