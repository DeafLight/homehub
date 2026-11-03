import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { FAMILY_ID, type PublicConfig } from '../shared/types.ts';

/** Agendas iCal : noms de variables d'environnement (app.env) qui contiennent les adresses secrètes. */
const calendarsSchema = z
  .array(z.string().regex(/^[A-Z][A-Z0-9_]*$/, "nom de variable d'environnement (MAJUSCULES, chiffres, _)"))
  .default([]);

const memberSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'minuscules, chiffres et tirets, 32 caractères max')
    .refine((id) => id !== FAMILY_ID, `« ${FAMILY_ID} » est réservé au dashboard commun`),
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'couleur au format #rrggbb'),
  /** Parent : écrit sur tous les profils. Un enfant (par défaut) n'écrit que sur le sien. */
  parent: z.boolean().default(false),
  calendars: calendarsSchema,
  /** Prénom de l'élève sur ÉcoleDirecte : affiche son emploi du temps sur ce profil. */
  ecoledirecte: z.string().trim().min(1).max(40).optional(),
  /** Prénom de l'enfant sur Pronote (compte parent appairé, voir README). */
  pronote: z.string().trim().min(1).max(40).optional(),
});

export const configSchema = z.object({
  members: z
    .array(memberSchema)
    .min(1, 'au moins un membre')
    .refine((members) => new Set(members.map((m) => m.id)).size === members.length, 'identifiants en double'),
  family: z
    .object({ name: z.string().trim().min(1).max(40), calendars: calendarsSchema })
    .default({ name: 'Famille', calendars: [] }),
  agenda: z.object({ refreshMinutes: z.number().int().min(1).max(180).default(10) }).default({ refreshMinutes: 10 }),
  ecoledirecte: z
    .object({ refreshMinutes: z.number().int().min(15).max(1440).default(60) })
    .default({ refreshMinutes: 60 }),
  pronote: z
    .object({ refreshMinutes: z.number().int().min(15).max(1440).default(60) })
    .default({ refreshMinutes: 60 }),
  /**
   * Tablette de la maison : adresses IP (vues par HomeHub derrière le proxy) qui peuvent modifier les listes et
   * appairer des téléphones sans jeton. Les autres appareils lisent seulement, sauf les téléphones appairés.
   */
  kiosk: z.object({ addresses: z.array(z.union([z.ipv4(), z.ipv6()])).default([]) }).default({ addresses: [] }),
  ui: z
    .object({ idleTimeoutSeconds: z.number().int().min(15).max(3600) })
    .default({ idleTimeoutSeconds: 180 }),
  /**
   * Reconnaissance faciale de la tablette, pour savoir qui écrit. `threshold` : ressemblance minimale (0 à 1) avec un
   * visage enregistré ; `margin` : avance minimale sur la personne suivante ; `antispoof` et `liveness` : scores
   * minimaux contre une photo ou un écran ; `sessionMinutes` : durée d'une identification sans geste.
   */
  faces: z
    .object({
      threshold: z.number().min(0).max(1).default(0.55),
      margin: z.number().min(0).max(1).default(0.05),
      antispoof: z.number().min(0).max(1).default(0.5),
      liveness: z.number().min(0).max(1).default(0.5),
      sessionMinutes: z.number().int().min(1).max(60).default(10),
    })
    .default({ threshold: 0.55, margin: 0.05, antispoof: 0.5, liveness: 0.5, sessionMinutes: 10 }),
  /** Absent : pas de météo affichée. */
  weather: z
    .object({
      label: z.string().trim().min(1).max(60),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      refreshMinutes: z.number().int().min(5).max(180).default(15),
    })
    .optional(),
});

export type WeatherConfig = NonNullable<AppConfig['weather']>;

/** Noms des agendas d'un profil (membre ou FAMILY_ID). */
export function calendarsOf(config: AppConfig, ownerId: string): string[] {
  if (ownerId === FAMILY_ID) return config.family.calendars;
  return config.members.find((m) => m.id === ownerId)?.calendars ?? [];
}

/** Vrai si au moins un profil a un agenda : on quitte alors les données d'exemple pour tout le monde. */
export const hasCalendars = (config: AppConfig) =>
  config.family.calendars.length > 0 || config.members.some((m) => m.calendars.length > 0);

export type AppConfig = z.infer<typeof configSchema>;

/** Valide une configuration déjà parsée ; lève une erreur lisible si elle est invalide. */
export function parseConfig(raw: unknown): AppConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Configuration invalide :\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Lit et valide le fichier YAML de configuration. */
export async function loadConfig(path: string): Promise<AppConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`Impossible de lire la configuration ${path} : ${(err as Error).message}`);
  }
  return parseConfig(parse(text));
}

export function toPublicConfig(config: AppConfig, revision: string): PublicConfig {
  return {
    members: config.members.map(({ id, name, color, parent }) => ({ id, name, color, parent })),
    family: { name: config.family.name },
    ui: config.ui,
    revision,
  };
}
