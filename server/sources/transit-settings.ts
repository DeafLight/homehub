// Réglages des transports (page « Transports » de la tablette) : lieux de la famille, trajet de chaque membre et
// arrêts de l'accueil, enregistrés dans le dossier d'état (transit-settings.json). Les adresses restent donc sur le
// NAS. Tant que la page n'a jamais été enregistrée, les sections `transit.stops` et `commute` du YAML s'appliquent.
import { z } from 'zod';
import type { Author, CommuteSettings, HomeStop, TimeWindow, TransitSettings } from '../../shared/types.ts';
import { WEEK_DAYS } from '../config.ts';
import type { ConfigProvider } from '../config-store.ts';
import { createHousehold } from '../household.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema } from './schemas.ts';
import type { Clock } from './types.ts';

export const MAX_PLACES = 8;
export const MAX_HOME_STOPS = 4;
export const DEFAULT_ARRIVE_BEFORE = 10;
export const DEFAULT_SHOW_BEFORE = 30;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure HH:MM');
const stopId = z.string().trim().regex(/^[A-Za-z0-9_:.-]{1,40}$/, 'arrêt inconnu');
const line = z.string().trim().min(1).max(10);
const minutes = (max: number) => z.number().int().min(0).max(max);
const name = (what: string) => z.string().trim().min(1, `${what} sans nom`).max(80);

const placeSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1, 'lieu sans nom').max(30),
  icon: z.enum(['home', 'school', 'sport', 'place']),
  address: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const routeSchema = z.object({
  line,
  origin: stopId,
  originName: name('arrêt'),
  destination: stopId,
  destinationName: name('arrêt'),
  towards: z.string().max(80),
  headsigns: z.array(z.string().max(80)).max(20),
  oneWay: z.boolean(),
  rideMinutes: minutes(180),
  walkFrom: minutes(60),
  walkTo: minutes(60),
});

const commuteSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    route: routeSchema.nullable(),
    mode: z.enum(['school', 'window']),
    days: z.array(z.number().int().min(0).max(6)).min(1, 'au moins un jour').transform((d) => [...new Set(d)].sort()),
    window: z.object({ from: hhmm, to: hhmm }).refine((w) => w.from < w.to, 'le début doit précéder la fin'),
    arriveBefore: minutes(60),
    showBefore: minutes(120).refine((m) => m >= 5, 'carte affichée au moins 5 min avant'),
    walkFrom: minutes(60).nullable(),
    walkTo: minutes(60).nullable(),
  })
  .refine((c) => c.from !== c.to, 'départ et arrivée identiques');

/** Ce que la page envoie à l'enregistrement. */
export const transitSettingsInput = z
  .object({
    places: z.array(placeSchema).max(MAX_PLACES, `${MAX_PLACES} lieux au plus`),
    commutes: z.record(z.string(), commuteSchema),
    stops: z
      .array(z.object({ id: stopId, label: z.string().trim().min(1).max(40).optional(), lines: z.array(line).max(10).optional() }))
      .max(MAX_HOME_STOPS, `${MAX_HOME_STOPS} arrêts au plus à l'accueil`),
  })
  .refine((s) => new Set(s.places.map((p) => p.id)).size === s.places.length, 'lieux en double')
  .refine((s) => new Set(s.places.map((p) => p.label.toLowerCase())).size === s.places.length, 'deux lieux portent le même nom')
  .refine((s) => Object.values(s.commutes).every((c) => [c.from, c.to].every((id) => s.places.some((p) => p.id === id))), 'trajet vers un lieu supprimé');
export type TransitSettingsInput = z.infer<typeof transitSettingsInput>;

const fileSchema = z.object({
  version: z.literal(1),
  settings: transitSettingsInput,
  updatedAt: z.string(),
  by: authorSchema,
});
type SettingsFile = z.infer<typeof fileSchema>;

/** Trajet tel que le dashboard l'utilise, venu de la page ou du YAML. */
export type CommuteTrip = {
  line: string;
  origin: string;
  /** Arrêt d'arrivée : absent pour un trajet du YAML (pas de calcul selon l'emploi du temps). */
  destination?: string;
  /** Filtre de direction : destinations des courses qui desservent l'arrivée (inutile si `oneWay`). */
  headsigns: string[];
  oneWay: boolean;
  label?: string;
  walkFrom: number;
  walkTo: number;
  mode: 'school' | 'window';
  days: number[];
  window: TimeWindow;
  arriveBefore: number;
  showBefore: number;
};

export type TransitSettingsStore = {
  load(): Promise<void>;
  /** Réglages de la page (ou ceux du YAML, convertis, tant qu'elle n'a pas été enregistrée). */
  current(): TransitSettings;
  save(input: TransitSettingsInput, by: Author): Promise<TransitSettings>;
  /** Arrêts de l'accueil en vigueur. */
  homeStops(): HomeStop[];
  /** Trajet en vigueur de `ownerId` ; null sans trajet (ou sans ligne choisie). */
  commuteFor(ownerId: string): CommuteTrip | null;
};

/** Trajet d'un membre décrit dans le YAML (section `commute`), tant que la page n'a pas été enregistrée. */
function commuteFromYaml(config: ConfigProvider, ownerId: string): CommuteTrip | null {
  const c = createHousehold(config).member(ownerId)?.commute;
  if (!c) return null;
  return {
    line: c.line,
    origin: c.stop,
    headsigns: c.towards ? [c.towards] : [],
    oneWay: !c.towards,
    ...(c.label && { label: c.label }),
    walkFrom: c.walkMinutes,
    walkTo: 0,
    mode: 'window',
    days: c.days.map((d) => WEEK_DAYS.indexOf(d)),
    window: { from: c.from, to: c.to },
    arriveBefore: DEFAULT_ARRIVE_BEFORE,
    showBefore: DEFAULT_SHOW_BEFORE,
  };
}

/** Réglages des transports d'après le YAML seul (sans page enregistrée) : arrêts de l'accueil et trajets. */
export const transitSettingsFromConfig = (config: ConfigProvider): Pick<TransitSettingsStore, 'homeStops' | 'commuteFor'> => ({
  homeStops: () => config.current().transit.stops,
  commuteFor: (ownerId) => commuteFromYaml(config, ownerId),
});

export function createTransitSettingsStore({ path, clock, config }: { path: string; clock: Clock; config: ConfigProvider }): TransitSettingsStore {
  /** null : page jamais enregistrée (le YAML s'applique). */
  const state = createJsonFile<SettingsFile | null>({ path, schema: fileSchema.nullable(), initial: () => null, pretty: true });
  const saved = () => state.current();

  const current = (): TransitSettings => {
    const file = saved();
    return file
      ? { ...(file.settings as Omit<TransitSettings, 'saved'>), saved: true }
      : { places: [], commutes: {}, stops: config.current().transit.stops, saved: false };
  };

  const yaml = transitSettingsFromConfig(config);

  function fromPage(settings: TransitSettingsInput, ownerId: string): CommuteTrip | null {
    const c: CommuteSettings | undefined = settings.commutes[ownerId];
    if (!c?.route) return null;
    const to = settings.places.find((p) => p.id === c.to);
    return {
      line: c.route.line,
      origin: c.route.origin,
      destination: c.route.destination,
      headsigns: c.route.headsigns,
      oneWay: c.route.oneWay,
      ...(to && { label: to.label }),
      walkFrom: c.walkFrom ?? c.route.walkFrom,
      walkTo: c.walkTo ?? c.route.walkTo,
      mode: c.mode,
      days: c.days,
      window: c.window,
      arriveBefore: c.arriveBefore,
      showBefore: c.showBefore,
    };
  }

  return {
    async load() {
      await state.read();
    },

    current,

    async save(input, by) {
      await state.replace({ version: 1, settings: input, updatedAt: clock().toISOString(), by });
      return current();
    },

    homeStops: () => saved()?.settings.stops ?? yaml.homeStops(),
    commuteFor: (ownerId) => {
      const file = saved();
      return file ? fromPage(file.settings, ownerId) : yaml.commuteFor(ownerId);
    },
  };
}
