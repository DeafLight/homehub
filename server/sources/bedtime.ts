// Heure du coucher des enfants (fonction 16) : réglages faits par un parent sur la tablette (heure par soir, période
// d'école et vacances, délais du rappel et de l'écran de veille) et décisions de ce soir (report, annulation, dernier
// temps envoyé aux télés), pour que rien ne reparte deux fois si le serveur redémarre. Enregistrés dans le dossier
// d'état (bedtime.json) ; sans chemin (tests) : en mémoire. Les décisions d'un soir s'effacent le lendemain.
import { z } from 'zod';
import {
  BEDTIME_EARLIEST,
  BEDTIME_LATEST,
  BEDTIME_POSTPONE_MAX_MIN,
  BEDTIME_REMINDER_CHOICES,
  BEDTIME_SLEEP_CHOICES,
  type BedtimeSettings,
  bedtimeWithDefaults,
} from '../../shared/bedtime.ts';
import type { Author } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema } from './schemas.ts';

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'heure HH:MM')
  .refine((t) => t >= BEDTIME_EARLIEST && t <= BEDTIME_LATEST, `heure entre ${BEDTIME_EARLIEST} et ${BEDTIME_LATEST}`);
const weekSchema = z.array(hhmm.nullable()).length(7);
const choice = (values: readonly number[]) => z.number().int().refine((n) => values.includes(n), `une valeur parmi ${values.join(', ')}`);

/** Réglages envoyés par la tablette (tous les champs). */
export const bedtimeSettingsInput = z.object({
  enabled: z.boolean(),
  school: weekSchema,
  holidays: weekSchema,
  reminderMin: choice(BEDTIME_REMINDER_CHOICES),
  sleepMin: choice(BEDTIME_SLEEP_CHOICES),
});

/** Décisions du soir `day` : report, annulation, et dernier temps envoyé (-1 aucun) pour l'heure `sentFor`. */
export type BedtimeEvening = { day: string; delayMin: number; cancelled: boolean; sent: number; sentFor: string | null };

const eveningSchema = z.object({
  day: z.string(),
  delayMin: z.number().int().min(0).max(BEDTIME_POSTPONE_MAX_MIN),
  cancelled: z.boolean(),
  sent: z.number().int().min(-1).max(2),
  sentFor: z.string().nullable(),
});

const fileSchema = z.object({
  version: z.literal(1),
  settings: bedtimeSettingsInput.partial().optional(),
  evening: eveningSchema.optional(),
  updatedAt: z.string().optional(),
  by: authorSchema.optional(),
});
type BedtimeFile = z.infer<typeof fileSchema>;

export type BedtimeStore = {
  settings(): Promise<BedtimeSettings>;
  save(settings: BedtimeSettings, by: Author, at: Date): Promise<BedtimeSettings>;
  /** Décisions du soir `day` (rien de décidé : pas de report, pas d'annulation, rien d'envoyé). */
  evening(day: string): Promise<BedtimeEvening>;
  setEvening(evening: BedtimeEvening): Promise<void>;
};

const freshEvening = (day: string): BedtimeEvening => ({ day, delayMin: 0, cancelled: false, sent: -1, sentFor: null });

export function createBedtimeStore({ path }: { path?: string } = {}): BedtimeStore {
  const file = path
    ? createJsonFile<BedtimeFile>({ path, schema: fileSchema, initial: () => ({ version: 1 }), pretty: true })
    : (() => {
        let value: BedtimeFile = { version: 1 };
        return {
          read: async () => value,
          update: async (apply: (draft: BedtimeFile) => void) => {
            const draft = structuredClone(value);
            apply(draft);
            value = draft;
          },
        };
      })();

  return {
    async settings() {
      return bedtimeWithDefaults((await file.read()).settings);
    },

    async save(settings, by, at) {
      await file.update((draft) => {
        draft.settings = settings;
        draft.updatedAt = at.toISOString();
        draft.by = by;
      });
      return bedtimeWithDefaults(settings);
    },

    async evening(day) {
      const saved = (await file.read()).evening;
      return saved?.day === day ? { ...saved } : freshEvening(day);
    },

    async setEvening(evening) {
      await file.update((draft) => {
        draft.evening = { ...evening };
      });
    },
  };
}
