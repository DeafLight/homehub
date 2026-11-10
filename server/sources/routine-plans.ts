// Réglages des routines (étapes de chaque membre, heures d'affichage), modifiés depuis la page « Routines » de la
// tablette et enregistrés dans le dossier d'état (routine-plans.json). Avant le premier enregistrement : aucune étape,
// heures par défaut. Chaque étape a un identifiant stable, qui sert de clé aux cases cochées (routines.json) : la
// renommer ne perd ni les cases du jour ni les jours de suite.
import { z } from 'zod';
import type { Author, RoutinePlan, RoutineSettings, RoutineWindows } from '../../shared/types.ts';
import type { ConfigProvider } from '../config-store.ts';
import { createHousehold } from '../household.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema } from './schemas.ts';
import type { Clock } from './types.ts';

export const MAX_ROUTINE_STEPS = 12;

/** Heures d'affichage tant que rien n'est enregistré. */
export const DEFAULT_ROUTINE_WINDOWS: RoutineWindows = {
  morning: { from: '05:00', to: '11:00' },
  evening: { from: '17:00', to: '23:00' },
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure HH:MM');
const timeWindow = z.object({ from: hhmm, to: hhmm }).refine((w) => w.from < w.to, 'le début doit précéder la fin');

const stepSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1, 'étape sans nom').max(60),
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1, 'au moins un jour')
    .nullable()
    // Tous les jours cochés : comme aucun jour précisé.
    .transform((days) => (!days || new Set(days).size === 7 ? null : [...new Set(days)].sort())),
});

const stepsSchema = z
  .array(stepSchema)
  .max(MAX_ROUTINE_STEPS, `${MAX_ROUTINE_STEPS} étapes au plus`)
  .refine((steps) => new Set(steps.map((s) => s.id)).size === steps.length, 'identifiants en double')
  .refine((steps) => new Set(steps.map((s) => s.label.toLowerCase())).size === steps.length, 'deux étapes portent le même nom');

/** Ce que la page envoie à l'enregistrement. */
export const routineSettingsInput = z.object({
  members: z.record(z.string(), z.object({ morning: stepsSchema, evening: stepsSchema })),
  windows: z.object({
    morning: timeWindow,
    evening: timeWindow,
    weekend: z.object({ morning: timeWindow.optional(), evening: timeWindow.optional() }).optional(),
  }),
});
export type RoutineSettingsInput = z.infer<typeof routineSettingsInput>;

const fileSchema = routineSettingsInput.extend({
  version: z.literal(1),
  updatedAt: z.string(),
  by: authorSchema,
});
type PlansFile = z.infer<typeof fileSchema>;

const NO_STEPS: RoutinePlan = { morning: [], evening: [] };

export type RoutinePlanStore = {
  /** Lit le fichier (au démarrage). */
  load(): Promise<void>;
  /** Réglages en vigueur, pour chaque membre de la configuration (sans étape s'il n'en a pas). */
  current(): RoutineSettings;
  /** Enregistre les réglages (membres inconnus de la configuration : refusés avant, par l'API). */
  save(input: RoutineSettingsInput, by: Author): Promise<RoutineSettings>;
};

export function createRoutinePlanStore({ path, clock, config }: { path: string; clock: Clock; config: ConfigProvider }): RoutinePlanStore {
  /** null : jamais enregistrés. */
  const household = createHousehold(config);
  const state = createJsonFile<PlansFile | null>({ path, schema: fileSchema.nullable(), initial: () => null, pretty: true });

  const current = (): RoutineSettings => {
    const saved = state.current();
    return {
      windows: saved?.windows ?? DEFAULT_ROUTINE_WINDOWS,
      members: Object.fromEntries(household.members().map((m) => [m.id, saved?.members[m.id] ?? NO_STEPS])),
    };
  };

  return {
    async load() {
      await state.read();
    },

    current,

    async save(input, by) {
      // Les membres absents de l'envoi gardent leurs étapes.
      const members = { ...state.current()?.members, ...input.members };
      await state.replace({ version: 1, members, windows: input.windows, updatedAt: clock().toISOString(), by });
      return current();
    },
  };
}
