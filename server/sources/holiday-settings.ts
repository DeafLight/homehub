// Réglage des vacances scolaires (page « Vacances scolaires » de la tablette) : académie, zone ou rien, enregistré
// dans le dossier d'état (holiday-settings.json). Tant que la page n'a jamais été enregistrée, la section `holidays`
// de homehub.yaml s'applique.
import { z } from 'zod';
import type { Author, HolidayChoice, HolidaySettings } from '../../shared/types.ts';
import type { HolidaysConfig } from '../config.ts';
import type { ConfigProvider } from '../config-store.ts';
import { createJsonFile } from './json-file.ts';
import { ACADEMIES, findAcademie } from './school-holidays.ts';
import { authorSchema } from './schemas.ts';
import type { Clock } from './types.ts';

const academieSchema = z
  .string()
  .trim()
  .max(60)
  .transform((name, ctx) => {
    const official = findAcademie(name);
    if (!official) ctx.addIssue({ code: 'custom', message: `académie inconnue : ${name}` });
    return official ?? name;
  });

/** Choix envoyé par la page : une académie connue, une zone A/B/C, ou null pour ne plus afficher de vacances. */
export const holidayChoiceSchema = z
  .object({ academie: academieSchema.optional(), zone: z.enum(['A', 'B', 'C'], 'zone A, B ou C').optional() })
  .strict()
  .refine((c) => (c.academie === undefined) !== (c.zone === undefined), 'une académie ou une zone, pas les deux')
  .transform((c): NonNullable<HolidayChoice> => (c.academie !== undefined ? { academie: c.academie } : { zone: c.zone ?? 'A' }))
  .nullable();

export const holidaySettingsInput = z.object({ choice: holidayChoiceSchema });
export type HolidaySettingsInput = z.infer<typeof holidaySettingsInput>;

const fileSchema = z.object({
  version: z.literal(1),
  choice: holidayChoiceSchema,
  updatedAt: z.string(),
  by: authorSchema,
});
type SettingsFile = z.infer<typeof fileSchema>;

/** Toutes les académies du calendrier, dans l'ordre de la liste officielle. */
export const academies = () => Object.entries(ACADEMIES).map(([name, zone]) => ({ name, zone }));

/** Choix de homehub.yaml (nom d'académie remis à sa forme officielle). */
function choiceFromYaml(holidays: HolidaysConfig | undefined): HolidayChoice {
  if (holidays?.academie) return { academie: findAcademie(holidays.academie) ?? holidays.academie };
  if (holidays?.zone) return { zone: holidays.zone };
  return null;
}

/** Réglage tel que la source du calendrier l'attend ; undefined : pas de vacances. */
export const choiceToConfig = (choice: HolidayChoice): HolidaysConfig | undefined => choice ?? undefined;

export type HolidaySettingsStore = {
  load(): Promise<void>;
  /** Choix en vigueur (page, sinon YAML) et liste des académies. */
  current(): HolidaySettings;
  save(input: HolidaySettingsInput, by: Author): Promise<HolidaySettings>;
  /** Réglage lu par la source du calendrier à chaque appel. */
  settings(): HolidaysConfig | undefined;
};

export function createHolidaySettingsStore({ path, clock, config }: { path: string; clock: Clock; config: ConfigProvider }): HolidaySettingsStore {
  /** null : page jamais enregistrée (le YAML s'applique). */
  const state = createJsonFile<SettingsFile | null>({ path, schema: fileSchema.nullable(), initial: () => null, pretty: true });
  const choice = (): HolidayChoice => {
    const file = state.current();
    return file ? file.choice : choiceFromYaml(config.current().holidays);
  };
  const current = (): HolidaySettings => ({ choice: choice(), saved: state.current() !== null, academies: academies() });

  return {
    async load() {
      await state.read();
    },
    current,
    async save(input, by) {
      await state.replace({ version: 1, choice: input.choice, updatedAt: clock().toISOString(), by });
      return current();
    },
    settings: () => choiceToConfig(choice()),
  };
}
