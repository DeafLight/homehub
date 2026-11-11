// Configuration de HomeHub (homehub.yaml) : schéma zod de chaque section (membres, tablette, transports, météo,
// sources scolaires…), lecture du fichier, et version publique envoyée au front (sans secret ni adresse).
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { FAMILY_ID, type PublicConfig } from '../shared/types.ts';
import { findAcademie } from './sources/school-holidays.ts';

/** Agendas iCal : noms de variables d'environnement (app.env) qui contiennent les adresses secrètes. */
const calendarsSchema = z
  .array(z.string().regex(/^[A-Z][A-Z0-9_]*$/, "nom de variable d'environnement (MAJUSCULES, chiffres, _)"))
  .default([]);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure au format HH:MM');
/** Identifiant d'arrêt Irigo (SIRI StopPointRef, un quai dans un sens) : scripts/irigo-stops.ts les liste. */
const stopRef = z.string().trim().regex(/^[A-Za-z0-9_:.-]{1,40}$/, 'identifiant d’arrêt Irigo (voir scripts/irigo-stops.ts)');
/** Ligne Irigo telle qu'affichée (« 3 », « A ») ; « 03 » et « 3 » désignent la même. */
const lineRef = z.string().trim().min(1).max(10);
export const WEEK_DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'] as const;

/** Trajet du matin vers l'école : carte « Pars dans N min » sur le dashboard, aux heures et jours donnés. */
const commuteSchema = z
  .object({
    stop: stopRef,
    line: lineRef,
    /** Partie du nom de la destination (« Centre »), si l'arrêt voit passer la ligne dans les deux sens. */
    towards: z.string().trim().min(1).max(40).optional(),
    /** Où l'on va (affiché) : « Collège ». */
    label: z.string().trim().min(1).max(40).optional(),
    walkMinutes: z.number().int().min(0).max(60).default(5),
    from: hhmm.default('07:00'),
    to: hhmm.default('08:30'),
    days: z.array(z.enum(WEEK_DAYS)).min(1).default(['lun', 'mar', 'mer', 'jeu', 'ven']),
  })
  .refine((c) => c.from < c.to, { message: '`from` doit précéder `to`' });

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
  commute: commuteSchema.optional(),
  /** Programme de renforcement sur le téléphone (onglet Sport) : adultes seulement. */
  fitness: z.boolean().default(false),
}).refine((m) => !m.fitness || m.parent, { message: '`fitness` est réservé aux adultes (`parent: true`)', path: ['fitness'] });

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
  /**
   * Proxys de confiance (adresses ou plages CIDR) : seuls ceux-là peuvent dire, par X-Real-IP ou X-Forwarded-For,
   * quelle est l'adresse du client. Par défaut aucun : l'adresse retenue est celle de la connexion (voir access.ts).
   */
  trustedProxies: z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()])).default([]),
  /**
   * `idleTimeoutSeconds` : retour à l'accueil sans contact ; `screensaverMinutes` : veille de la tablette (écran noir,
   * horloge qui se déplace) sans contact ni visage devant la caméra, 0 : jamais.
   */
  ui: z
    .object({
      idleTimeoutSeconds: z.number().int().min(15).max(3600),
      screensaverMinutes: z.number().int().min(0).max(240).default(5),
    })
    .default({ idleTimeoutSeconds: 180, screensaverMinutes: 5 }),
  /**
   * Reconnaissance faciale de la tablette, pour savoir qui écrit. `threshold` : ressemblance minimale (0 à 1) avec un
   * visage enregistré ; `margin` : avance minimale sur la personne suivante ; `antispoof` et `liveness` : scores
   * minimaux contre une photo ou un écran ; `sessionMinutes` : durée d'une identification sans geste. Détection, sur la
   * tablette : `minConfidence`, confiance minimale pour voir un visage (plus bas : de plus loin, plus de fausses
   * détections) ; `minSize`, largeur minimale du visage (part de l'image, 0 : aucune) pour tenter de le reconnaître
   * (plus petit, il réveille seulement la tablette). `learnMinutes` : au plus une empreinte apprise par personne et
   * par période, lors d'une reconnaissance sûre (0 : jamais).
   */
  faces: z
    .object({
      threshold: z.number().min(0).max(1).default(0.55),
      margin: z.number().min(0).max(1).default(0.05),
      antispoof: z.number().min(0).max(1).default(0.2),
      liveness: z.number().min(0).max(1).default(0.2),
      sessionMinutes: z.number().int().min(1).max(60).default(10),
      minConfidence: z.number().min(0.1).max(0.95).default(0.5),
      minSize: z.number().min(0).max(0.6).default(0),
      learnMinutes: z.number().int().min(0).max(10_080).default(30),
    })
    .default({
      threshold: 0.55,
      margin: 0.05,
      antispoof: 0.2,
      liveness: 0.2,
      sessionMinutes: 10,
      minConfidence: 0.5,
      minSize: 0,
      learnMinutes: 30,
    }),
  /**
   * Bus et tram Irigo (temps réel SIRI, open data d'Angers Loire Métropole) : prochains passages aux arrêts listés,
   * sur l'accueil et la veille. Absent : rien n'est affiché (le trajet d'un membre marche aussi sans).
   */
  transit: z
    .object({
      stops: z
        .array(z.object({ id: stopRef, label: z.string().trim().min(1).max(40).optional(), lines: z.array(lineRef).optional() }))
        .max(4)
        .default([]),
      refreshSeconds: z.number().int().min(30).max(600).default(60),
    })
    .default({ stops: [], refreshSeconds: 60 }),
  /**
   * Vacances scolaires (calendrier officiel) : `academie` (« Nantes ») ou `zone` (A, B ou C), l'un ou l'autre. La
   * Corse et l'outre-mer se règlent par l'académie. Absent : rien n'est affiché, les jours d'école restent les mêmes.
   */
  holidays: z
    .object({
      academie: z
        .string()
        .trim()
        .refine((a) => findAcademie(a) !== undefined, 'académie inconnue (ex. « Nantes », « Orléans-Tours », « Corse », « Réunion »)')
        .optional(),
      zone: z.enum(['A', 'B', 'C']).optional(),
    })
    .refine((h) => (h.academie === undefined) !== (h.zone === undefined), { message: 'donner `academie` ou `zone`, pas les deux' })
    .optional(),
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
export type HolidaysConfig = NonNullable<AppConfig['holidays']>;

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
    members: config.members.map(({ id, name, color, parent, fitness }) => ({ id, name, color, parent, ...(fitness && { fitness }) })),
    family: { name: config.family.name },
    ui: config.ui,
    faces: { minConfidence: config.faces.minConfidence, minSize: config.faces.minSize },
    revision,
  };
}
