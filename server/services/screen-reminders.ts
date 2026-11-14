// Planification des rappels sur la télé (shared/screen-reminders.ts) : toutes les 30 s, chaque rappel actif dont l'heure
// est passée (rattrapage compris) et pas encore envoyé ce jour est construit (texte du moment), puis poussé en bandeau à
// chaque télé allumée. Une télé en veille ou injoignable ne reçoit rien : le rappel attend qu'une télé s'allume, jusqu'à
// la fin du rattrapage. Rien à rappeler (routines faites, mots lus) : pas de bandeau, et c'est fini pour ce jour-là.
// « Essayer » (tablette) envoie un rappel tout de suite, quelle que soit l'heure. Chaque genre a son constructeur de
// texte : l'heure du coucher (fonction 16) n'aura qu'à ajouter le sien.
import { randomUUID } from 'node:crypto';
import { localDay } from '../../shared/dates.ts';
import {
  notesReminderText,
  reminderDue,
  routineReminderText,
  SCREEN_REMINDER_SECONDS,
  type ScreenReminderEvent,
  type ScreenReminderKind,
  type ScreenReminderText,
} from '../../shared/screen-reminders.ts';
import type { Routine } from '../../shared/types.ts';
import { FAMILY_ID } from '../../shared/types.ts';
import type { Household } from '../household.ts';
import { fail } from '../http.ts';
import type { ScreenReminderStore } from '../sources/screen-reminders.ts';
import type { Clock, NoteSource } from '../sources/types.ts';
import { SCREEN_OFFLINE, type ScreenHub } from './screens.ts';

/** Intervalle de vérification des heures. */
export const REMINDER_TICK_MS = 30_000;
/** Attente du compte rendu de la télé pour un bandeau (rien à télécharger). */
export const REMINDER_REPORT_MS = 5_000;
export const NOTHING_TO_REMIND = 'Rien à rappeler pour l’instant';
/** Nom affiché pour les mots laissés à toute la famille (pas le nom de famille : la télé se voit de loin). */
export const FAMILY_LABEL = 'Toute la famille';

/** Construit le texte d'un rappel au moment de l'envoi ; null : rien à rappeler. */
export type ReminderBuilder = () => Promise<ScreenReminderText>;

/** Constructeurs des rappels d'aujourd'hui : routine du soir (étapes pas cochées), mots pas encore vus. */
export function reminderBuilders({
  household,
  routineOf,
  notes,
}: {
  household: Pick<Household, 'members'>;
  /** Routine du moment d'un membre (DashboardService.routine). */
  routineOf: (ownerId: string) => Promise<Routine | null>;
  notes: NoteSource;
}): Record<ScreenReminderKind, ReminderBuilder> {
  return {
    async 'evening-routine'() {
      const members = household.members();
      const routines = await Promise.all(members.map((m) => routineOf(m.id)));
      return routineReminderText(
        members.map((m, i) => {
          const routine = routines[i];
          // Hors des heures du soir (réglage de la page Routines), rien : le rappel ne parle que de la routine du soir.
          return { name: m.name, left: routine?.period === 'evening' ? routine.items.filter((s) => !s.done).length : 0 };
        }),
      );
    },
    async notes() {
      const owners = [...household.members().map((m) => ({ id: m.id, name: m.name })), { id: FAMILY_ID, name: FAMILY_LABEL }];
      const counts = await Promise.all(owners.map((o) => notes.unseenFor(o.id)));
      return notesReminderText(owners.map((o, i) => ({ name: o.name, count: counts[i].length })));
    },
  };
}

export type ScreenReminders = ReturnType<typeof createScreenReminders>;

export function createScreenReminders({
  store,
  hub,
  screenIds,
  builders,
  clock,
  logger = console,
}: {
  store: ScreenReminderStore;
  hub: Pick<ScreenHub, 'power' | 'send'>;
  /** Identifiants des télés appairées. */
  screenIds: () => Promise<string[]>;
  builders: Record<ScreenReminderKind, ReminderBuilder>;
  clock: Clock;
  logger?: Pick<Console, 'error' | 'log'>;
}) {
  const allumees = async () => (await screenIds()).filter((id) => hub.power(id) === 'on');

  /** Pousse le bandeau à chaque télé `ids` ; renvoie celles qui l'ont affiché. */
  const push = async (kind: ScreenReminderKind, text: NonNullable<ScreenReminderText>, ids: string[]) => {
    const results = await Promise.all(
      ids.map(async (id) => {
        const event: ScreenReminderEvent = { kind: 'reminder', id: randomUUID(), reminder: kind, ...text, seconds: SCREEN_REMINDER_SECONDS };
        const report = await hub.send(id, event, REMINDER_REPORT_MS).catch((err: unknown) => ({ ok: false as const, reason: (err as Error).message }));
        if (!report.ok) logger.error(`Rappel « ${text.title} » non affiché sur la télé ${id} : ${report.reason}`);
        return report.ok ? id : null;
      }),
    );
    return results.filter((id): id is string => id !== null);
  };

  /** Une vérification : envoie les rappels dus. */
  async function tick() {
    const now = clock();
    const { reminders } = await store.current();
    for (const { kind, enabled, time } of reminders) {
      if (!enabled || !reminderDue(time, now, await store.sentDay(kind))) continue;
      const ids = await allumees();
      // Aucune télé allumée : on réessaie au prochain passage, tant que dure le rattrapage.
      if (!ids.length) continue;
      const text = await builders[kind]();
      await store.markSent(kind, localDay(now));
      if (!text) continue;
      const shown = await push(kind, text, ids);
      logger.log(`Rappel « ${text.title} » envoyé à ${shown.length} télé(s) sur ${ids.length}`);
    }
  }

  return {
    tick,

    /** Vérifie les heures toutes les REMINDER_TICK_MS ; renvoie de quoi arrêter. */
    start(intervalMs = REMINDER_TICK_MS) {
      const timer = setInterval(() => void tick().catch((err: unknown) => logger.error('Rappels sur la télé :', err)), intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },

    /** « Essayer » : le rappel `kind` tout de suite sur les télés allumées (409 s'il n'y a rien à rappeler, 503 sans télé). */
    async sendNow(kind: ScreenReminderKind): Promise<{ title: string; subtitle: string; screens: number }> {
      const ids = await allumees();
      if (!ids.length) return fail(503, SCREEN_OFFLINE);
      const text = (await builders[kind]()) ?? fail(409, NOTHING_TO_REMIND);
      const shown = await push(kind, text, ids);
      if (!shown.length) return fail(502, 'La télé n’a pas affiché le rappel');
      return { ...text, screens: shown.length };
    },
  };
}
