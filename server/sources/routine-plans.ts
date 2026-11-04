// Réglages des routines (étapes de chaque membre, heures d'affichage), modifiés depuis la page « Routines » de la
// tablette et enregistrés dans le dossier d'état (routine-plans.json). Tant que rien n'y est enregistré, ce sont ceux
// de homehub.yaml ; ensuite, le fichier l'emporte (un membre ajouté plus tard dans homehub.yaml garde ses étapes du
// yaml jusqu'au premier enregistrement qui le concerne). Chaque étape a un identifiant stable, qui sert de clé aux
// cases cochées (routines.json) : la renommer ne perd ni les cases du jour ni les jours de suite. Une étape venue du
// yaml prend son libellé pour identifiant, la clé qu'elle avait déjà.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Author, RoutinePeriod, RoutinePlan, RoutineSettings, RoutineStepPlan } from '../../shared/types.ts';
import type { AppConfig } from '../config.ts';
import type { ConfigProvider } from '../config-store.ts';
import type { Clock } from './types.ts';

export const MAX_ROUTINE_STEPS = 12;

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
  by: z.object({ ownerId: z.string().nullable(), via: z.enum(['tablet', 'phone']) }),
});
type PlansFile = z.infer<typeof fileSchema>;

/** Étapes d'un membre telles que décrites dans homehub.yaml. */
function planFromConfig(member: AppConfig['members'][number]): RoutinePlan {
  const steps = (period: RoutinePeriod): RoutineStepPlan[] =>
    member.routines[period].map((s) => ({ id: s.label, label: s.label, days: s.days }));
  return { morning: steps('morning'), evening: steps('evening') };
}

/** Réglages en vigueur : ceux enregistrés depuis la tablette, sinon ceux de homehub.yaml. */
export function effectiveRoutines(config: AppConfig, saved: RoutineSettingsInput | null): RoutineSettings {
  return {
    source: saved ? 'tablet' : 'config',
    windows: saved?.windows ?? config.routines,
    members: Object.fromEntries(config.members.map((m) => [m.id, saved?.members[m.id] ?? planFromConfig(m)])),
  };
}

export type RoutinePlanStore = {
  /** Lit le fichier (au démarrage). */
  load(): Promise<void>;
  current(): RoutineSettings;
  /** Enregistre les réglages (membres inconnus de la configuration : refusés avant, par l'API). */
  save(input: RoutineSettingsInput, by: Author): Promise<RoutineSettings>;
};

export function createRoutinePlanStore({ path, clock, config }: { path: string; clock: Clock; config: ConfigProvider }): RoutinePlanStore {
  let saved: PlansFile | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  return {
    async load() {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        return;
      }
      const parsed = fileSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error(`${path} illisible :\n${z.prettifyError(parsed.error)}`);
      saved = parsed.data;
    },

    current: () => effectiveRoutines(config.current(), saved),

    save(input, by) {
      const run = queue.then(async () => {
        // Les membres qui ne sont pas dans l'envoi gardent leurs étapes en vigueur.
        const members = { ...effectiveRoutines(config.current(), saved).members, ...input.members };
        const file: PlansFile = { version: 1, members, windows: input.windows, updatedAt: clock().toISOString(), by };
        const tmp = `${path}.tmp`;
        await writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
        await rename(tmp, path);
        saved = file;
        return effectiveRoutines(config.current(), saved);
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
