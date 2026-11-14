// Réglages des rappels sur la télé (actif ou non, heure de chaque rappel), modifiés par un parent depuis la tablette
// (Téléphones › Rappels sur la télé), et jour du dernier envoi de chacun, pour n'envoyer qu'une fois par jour même si
// le serveur redémarre. Enregistrés dans le dossier d'état (screen-reminders.json). Avant le premier enregistrement :
// réglages par défaut (shared/screen-reminders.ts).
import { z } from 'zod';
import { SCREEN_REMINDER_KINDS, type ScreenReminderKind, type ScreenReminderSettings, withDefaults } from '../../shared/screen-reminders.ts';
import type { Author } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema } from './schemas.ts';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'heure HH:MM');
const settingSchema = z.object({ enabled: z.boolean(), time: hhmm });

/** Ce que la page envoie : un ou plusieurs rappels (les autres gardent leur réglage). */
export const screenRemindersInput = z.object({
  reminders: z.array(settingSchema.extend({ kind: z.enum(SCREEN_REMINDER_KINDS) })).min(1).max(SCREEN_REMINDER_KINDS.length),
});
export type ScreenRemindersInput = z.infer<typeof screenRemindersInput>;

const fileSchema = z.object({
  version: z.literal(1),
  // Clés libres : un genre retiré plus tard ne rend pas le fichier illisible.
  reminders: z.record(z.string(), settingSchema),
  /** Genre → jour local AAAA-MM-JJ du dernier envoi. */
  sent: z.record(z.string(), z.string()),
  updatedAt: z.string().optional(),
  by: authorSchema.optional(),
});
type RemindersFile = z.infer<typeof fileSchema>;

export type ScreenReminderStore = {
  current(): Promise<ScreenReminderSettings>;
  save(input: ScreenRemindersInput, by: Author, at: Date): Promise<ScreenReminderSettings>;
  /** Jour du dernier envoi du rappel `kind`, ou null. */
  sentDay(kind: ScreenReminderKind): Promise<string | null>;
  markSent(kind: ScreenReminderKind, day: string): Promise<void>;
};

export function createScreenReminderStore({ path }: { path: string }): ScreenReminderStore {
  const state = createJsonFile<RemindersFile>({ path, schema: fileSchema, initial: () => ({ version: 1, reminders: {}, sent: {} }), pretty: true });
  return {
    async current() {
      return withDefaults((await state.read()).reminders);
    },

    async save(input, by, at) {
      await state.update((file) => {
        for (const { kind, enabled, time } of input.reminders) file.reminders[kind] = { enabled, time };
        file.updatedAt = at.toISOString();
        file.by = by;
      });
      return withDefaults(state.current().reminders);
    },

    async sentDay(kind) {
      return (await state.read()).sent[kind] ?? null;
    },

    async markSent(kind, day) {
      await state.update((file) => {
        file.sent[kind] = day;
      });
    },
  };
}
