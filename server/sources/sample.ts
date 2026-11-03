// Sources d'exemple, en mémoire : elles donnent à chaque profil des données plausibles, calculées par rapport
// à l'heure courante pour que l'écran ait l'air vivant. À remplacer source par source par les vraies.
import type { CalendarEvent, Task, Weather, WeatherForecast } from '../../shared/types.ts';
import type { AgendaSource, Clock, SchoolSource, Sources, TaskSource, WeatherSource } from './types.ts';

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

/** `memberIds` : les membres dans l'ordre de la config ; chacun reçoit un jeu d'exemples différent. */
/** Les mots ne sont jamais d'exemple : ce sont ceux laissés par la famille (notes.ts). */
export function createSampleSources(memberIds: () => string[], familyId: string, clock: Clock): Omit<Sources, 'notes'> {
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


  const weather: WeatherSource = {
    // Courbe de température douce sur 24 h, une averse dans 3 h.
    async forecast(): Promise<WeatherForecast> {
      const start = clock();
      start.setMinutes(0, 0, 0);
      const hours = Array.from({ length: 25 }, (_, i) => {
        const time = new Date(start.getTime() + i * 3_600_000);
        const hour = time.getHours();
        return {
          time: time.toISOString(),
          temperatureC: 10 + 5 * Math.sin(((hour - 9) / 24) * 2 * Math.PI),
          precipitationMm: i >= 3 && i <= 5 ? 0.8 : 0,
          weatherCode: i >= 3 && i <= 5 ? 61 : 2,
          isDay: hour >= 8 && hour < 18,
        };
      });
      const days = [2, 3, 1, 61].map((weatherCode, i) => {
        const day = clock();
        day.setHours(0, 0, 0, 0);
        day.setDate(day.getDate() + i);
        const at = (h: number, m: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString();
        return {
          date: day.toISOString(),
          weatherCode,
          minC: 6 - i,
          maxC: 15 - i,
          precipitationMm: weatherCode === 61 ? 3.2 : 0,
          windMaxKmh: 18,
          sunrise: at(7, 40),
          sunset: at(17, 27),
        };
      });
      return {
        location: 'Exemple',
        observedAt: start.toISOString(),
        current: { temperatureC: 12, apparentC: 10, weatherCode: 2, isDay: true, humidityPct: 78, windKmh: 13, gustsKmh: 27, windFromDeg: 45 },
        hours,
        days,
      };
    },
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

  // Pas d'emploi du temps d'exemple : la carte « Cours » n'apparaît qu'avec ÉcoleDirecte.
  const school: SchoolSource = {
    async coursesFor() {
      return null;
    },
  };

  return { agenda, tasks, weather, school };
}
