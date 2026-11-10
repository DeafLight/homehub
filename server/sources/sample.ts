// Agenda d'exemple, en mémoire, tant qu'aucun agenda iCal n'est configuré (développement, première installation) :
// des événements plausibles pour chaque profil, calculés par rapport à l'heure courante.
import type { CalendarEvent } from '../../shared/types.ts';
import type { AgendaSource, Clock } from './types.ts';

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

/** `memberIds` : les membres dans l'ordre de la config ; chacun reçoit un jeu d'exemples différent. */
export function createSampleAgenda(memberIds: () => string[], familyId: string, clock: Clock): AgendaSource {
  const indexOf = (ownerId: string) => Math.max(0, memberIds().indexOf(ownerId));
  const templateFor = (ownerId: string): EventTemplate[] =>
    ownerId === familyId ? FAMILY_TEMPLATE : AGENDA_TEMPLATES[indexOf(ownerId) % AGENDA_TEMPLATES.length];

  return {
    async eventsFor(ownerId, range) {
      const today = clock();
      today.setHours(0, 0, 0, 0);
      return templateFor(ownerId)
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
}
