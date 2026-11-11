// Carnet de recettes, partagé entre le serveur et le front : la forme d'une recette (notre version, et la copie de
// la source importée), et les règles qui en découlent sans réseau : lignes d'ingrédients analysées, durées repérées
// dans une étape (minuteur), mode Cookeo, portions et temps lus dans les données schema.org.
import { guessAisle, ingredientKey, parseIngredientLine, type Unit } from './ingredients.ts';
import type { Author } from './types.ts';

export const RECIPE_LIMITS = {
  title: 200,
  line: 300,
  ingredients: 120,
  steps: 80,
  step: 2000,
  tips: 4000,
  section: 120,
} as const;

/** Ligne d'ingrédient : le texte tel qu'écrit, et ce qu'on en a compris (ou corrigé à la main). */
export type IngredientLine = {
  id: string;
  /** Ligne telle qu'écrite (ou réécrite dans notre version). */
  text: string;
  quantity: number | null;
  quantityMax: number | null;
  unit: Unit | null;
  /** Ce qui suit la quantité et l'unité (« gros oignons émincés »), pour réécrire la ligne à une autre échelle. */
  label: string;
  /** Nom au singulier (« oignon ») et sa clé normalisée (« oignon »), pour regrouper entre recettes. */
  name: string;
  key: string;
  notes: string;
  optional: boolean;
  /** Rayon (deviné, ou corrigé) ; null : inconnu. */
  aisle: string | null;
  /** Groupe dans la recette (« Pour la pâte »), sinon null. */
  section: string | null;
  /** Corrigée à la main : la ligne n'est plus réanalysée, la correction l'emporte. */
  manual: boolean;
};

export type RecipeStep = {
  id: string;
  text: string;
  section: string | null;
};

/** Contenu d'une recette : celui de la source (tel que lu), ou notre version (celle qui sert). */
export type RecipeContent = {
  title: string;
  /** Nombre de portions pour lesquelles les quantités sont écrites ; null : inconnu. */
  servings: number | null;
  /** Ce que comptent les portions quand ce ne sont pas des personnes (« crêpes ») ; null : des personnes. */
  servingsUnit: string | null;
  ingredients: IngredientLine[];
  steps: RecipeStep[];
  /** Nos astuces (texte libre). */
  tips: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  /** Appareil de la recette (Cookeo) ; null : cuisine classique. */
  appliance: 'cookeo' | null;
};

/**
 * D'où vient une recette importée : la page lue par le serveur (absent, les recettes d'avant la 0.50 aussi), un
 * texte copié de la page, ou la page enregistrée par le navigateur (.mhtml), quand le site refuse la lecture.
 */
export type RecipeOrigin = 'text' | 'saved-page';

export type RecipeSource = {
  /** Adresse de la page ; null : texte collé sans lien. */
  url: string | null;
  /** Nom du site (« Marmiton », sinon l'hôte ; « Texte collé » sans lien). */
  site: string;
  origin?: RecipeOrigin;
  importedAt: string;
  /** Photo d'origine (adresse sur le site). */
  imageUrl: string | null;
  /**
   * La recette telle que lue, jamais modifiée : consultable à côté de notre version. null : la page n'avait rien de
   * lisible, la recette a été saisie à la main (le lien reste).
   */
  content: RecipeContent | null;
};

export type Recipe = {
  id: string;
  /** Notre version : c'est elle qui sert. */
  ours: RecipeContent;
  /** Source importée ; null pour une recette saisie à la main. */
  source: RecipeSource | null;
  /** Photo gardée par HomeHub (servie par /api/recipes/:id/photo). */
  photo: boolean;
  addedBy: Author;
  addedAt: string;
  updatedBy?: Author;
  updatedAt?: string;
};

/** Ligne du carnet. */
export type RecipeSummary = Pick<Recipe, 'id' | 'photo' | 'addedBy' | 'addedAt'> & {
  title: string;
  servings: number | null;
  servingsUnit: string | null;
  totalMinutes: number | null;
  appliance: RecipeContent['appliance'];
  site: string | null;
  ingredients: number;
};

/** Ce qu'un import n'a pas pu lire : de quoi préremplir la saisie à la main. */
export type RecipeDraft = { url: string; title: string | null; site: string | null };

export type ImportResult = { recipe: Recipe; existing: boolean };

/**
 * Aperçu d'un import par texte collé ou page enregistrée : ce qui a été compris, à corriger avant d'enregistrer.
 * `token` désigne ce que le serveur garde en attendant (la source telle que lue, la photo de l'archive).
 */
export type ImportPreview = {
  preview: { token: string; content: RecipeContent; url: string | null; site: string; origin: RecipeOrigin; photo: boolean };
};

/** Mention de la source sous le titre : « Marmiton », « Texte collé », « Marmiton, page enregistrée ». */
export function sourceLabel(source: Pick<RecipeSource, 'site' | 'origin' | 'url'>): string {
  if (source.origin === 'text') return source.url ? `${source.site}, texte collé` : 'un texte collé';
  if (source.origin === 'saved-page') return `${source.site}, page enregistrée`;
  return source.site;
}

// --- Relecture de la source ---

/** Parties d'une recette que la relecture peut reprendre (nos astuces n'existent pas dans la source). */
export const REREAD_PARTS = {
  titre: ['title'],
  portions: ['servings', 'servingsUnit'],
  ingrédients: ['ingredients'],
  étapes: ['steps'],
  temps: ['prepMinutes', 'cookMinutes', 'totalMinutes'],
  appareil: ['appliance'],
} as const satisfies Record<string, readonly (keyof RecipeContent)[]>;
export type RereadPart = keyof typeof REREAD_PARTS;

/** Résultat d'une relecture : la recette, les parties reprises de la page, celles de notre version gardées malgré la page. */
export type RereadResult = { recipe: Recipe; updated: RereadPart[]; kept: RereadPart[] };

/** Une partie, comparable d'une lecture à l'autre : sans les identifiants des lignes et des étapes, tirés à chaque lecture. */
const partOf = (content: RecipeContent | null, part: RereadPart) =>
  content ? JSON.stringify(REREAD_PARTS[part].map((key) => content[key]), (name, value) => (name === 'id' ? undefined : value)) : null;
const emptyPart = (content: RecipeContent, part: RereadPart) =>
  REREAD_PARTS[part].every((key) => {
    const value = content[key];
    return value === null || value === '' || (Array.isArray(value) && value.length === 0);
  });

/**
 * Relecture de la source sans écraser notre version : une partie que nous n'avons pas touchée (identique à la
 * lecture précédente, ou vide, comme des étapes que la page n'avait pas données) prend la nouvelle lecture ; une
 * partie modifiée chez nous est gardée. `previous` : la lecture précédente (null pour une saisie à la main).
 */
export function mergeReread(ours: RecipeContent, previous: RecipeContent | null, fresh: RecipeContent): Omit<RereadResult, 'recipe'> & { ours: RecipeContent } {
  const merged: RecipeContent = structuredClone(ours);
  const updated: RereadPart[] = [];
  const kept: RereadPart[] = [];
  for (const part of Object.keys(REREAD_PARTS) as RereadPart[]) {
    if (partOf(ours, part) === partOf(fresh, part)) continue;
    const untouched = partOf(ours, part) === partOf(previous, part) || emptyPart(ours, part);
    if (!untouched) {
      kept.push(part);
      continue;
    }
    for (const key of REREAD_PARTS[part]) Object.assign(merged, { [key]: structuredClone(fresh[key]) });
    updated.push(part);
  }
  return { ours: merged, updated, kept };
}

// --- Lignes ---

/** Lignes analysées d'un texte d'ingrédient (« sel, poivre » en donne deux), avec des identifiants à partir de `nextId`. */
export function ingredientLines(text: string, section: string | null, nextId: () => string): IngredientLine[] {
  return parseIngredientLine(text).map((p) => {
    const key = ingredientKey(p.name);
    return { id: nextId(), text: text.trim(), ...p, key, aisle: guessAisle(key), section, manual: false };
  });
}

/** Réanalyse une ligne non corrigée à la main (texte modifié) ; une ligne corrigée garde ses champs. */
export function refreshLine(line: IngredientLine): IngredientLine {
  if (line.manual) return { ...line, key: ingredientKey(line.name) };
  const [first] = ingredientLines(line.text, line.section, () => line.id);
  return { ...first, aisle: line.aisle ?? first.aisle };
}

export const scaleFactor = (from: number | null, to: number | null) => (from && to ? to / from : 1);

// --- Temps et portions (schema.org) ---

/** Durée ISO 8601 (« PT1H30M », « P0DT0H35M ») ou nombre de minutes ; null si illisible ou nulle. */
export function isoMinutes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/iu.exec(value.trim());
  if (!match) return null;
  const [, d, h, m, s] = match.map((x) => (x === undefined ? 0 : Number(x)));
  const minutes = Math.round(Number(d) * 1440 + Number(h) * 60 + Number(m) + Number(s) / 60);
  return minutes > 0 ? minutes : null;
}

const PEOPLE = /^(personnes?|pers\.?|portions?|parts?|couverts?|servings?|people|persons?)$/iu;

/** Portions d'un recipeYield (« 4 », 4, ["1", "portion"], « 15 crêpes », « 4 à 6 personnes »). */
export function yieldOf(value: unknown): { servings: number | null; unit: string | null } {
  const values = (Array.isArray(value) ? value : [value]).filter((v) => typeof v === 'string' || typeof v === 'number');
  // ["6", "6 parts"] : l'élément le plus parlant ; ["1", "portion"] : les morceaux mis bout à bout.
  const text = (values.map(String).find((v) => /\d.*\p{L}/u.test(v)) ?? values.map(String).join(' ')).trim();
  const match = /(\d+(?:[.,]\d+)?)(?:\s*(?:à|-|–)\s*\d+)?\s*(.*)$/u.exec(text);
  if (!match) return { servings: null, unit: null };
  const servings = Math.round(Number(match[1].replace(',', '.')));
  const rest = match[2].trim().replace(/^de\s+/u, '');
  const unit = rest && !PEOPLE.test(rest) ? rest.slice(0, 40) : null;
  return { servings: servings > 0 ? Math.min(servings, 100) : null, unit };
}

/** « 1 h 15 », « 45 min ». */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// --- Étapes : durées (minuteur) et mode Cookeo ---

export type StepDuration = { seconds: number; text: string };

const WORD_DURATIONS: [RegExp, number][] = [
  [/\bune demi-heure\b/iu, 1800],
  [/\bun quart d['’]heure\b/iu, 900],
  [/\btrois quarts d['’]heure\b/iu, 2700],
  [/\bune heure\b/iu, 3600],
];
const SMALL_WORDS: Record<string, number> = { une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15, vingt: 20, trente: 30 };
const NUM = String.raw`(\d+(?:[.,]\d+)?|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|quinze|vingt|trente)`;
const DURATION_RE = new RegExp(
  String.raw`(?<![\p{L}\d])${NUM}(?:\s*(?:à|-|–)\s*\d+)?\s*(h(?:eures?)?|min(?:utes?|\.)?|mn|s(?:ec(?:ondes?)?)?)(?!\p{L})(?:\s*(\d{1,2})(?:\s*(?:min(?:utes?)?|mn))?(?![\p{L}\d]))?`,
  'giu',
);

const toNumber = (token: string) => SMALL_WORDS[token.toLowerCase()] ?? Number(token.replace(',', '.'));

/**
 * Durées citées dans une étape, pour lancer un minuteur : « 35 minutes », « 1 h 30 », « 1h30 », « 10 à 15 min »
 * (la plus courte, pour aller voir à temps), « une demi-heure ». Ni les températures ni les quantités.
 */
export function stepDurations(text: string): StepDuration[] {
  const found: (StepDuration & { at: number })[] = [];
  for (const match of text.matchAll(DURATION_RE)) {
    const [whole, amount, unit, extraMinutes] = match;
    const value = toNumber(amount);
    if (!Number.isFinite(value) || value <= 0) continue;
    const u = unit.toLowerCase();
    let seconds = u.startsWith('h') ? value * 3600 + (extraMinutes ? Number(extraMinutes) * 60 : 0) : u.startsWith('s') ? value : value * 60;
    seconds = Math.round(seconds);
    if (seconds < 5 || seconds > 24 * 3600) continue;
    found.push({ seconds, text: whole.trim(), at: match.index ?? 0 });
  }
  for (const [re, seconds] of WORD_DURATIONS) {
    const match = re.exec(text);
    if (match && !found.some((f) => Math.abs(f.at - (match.index ?? 0)) < 3)) found.push({ seconds, text: match[0], at: match.index ?? 0 });
  }
  return found.sort((a, b) => a.at - b.at).map(({ seconds, text: t }) => ({ seconds, text: t }));
}

const COOKEO_MODES: [RegExp, string][] = [
  [/sous\s+pression|cuisson\s+rapide/iu, 'Sous pression'],
  [/mode\s+dorer|\bfaire\s+dorer\s+(?:en\s+)?mode|programme\s+dorer/iu, 'Dorer'],
  [/mode\s+mijoter|programme\s+mijoter/iu, 'Mijoter'],
  [/mode\s+r[ée]chauffer/iu, 'Réchauffer'],
  [/maintien\s+au\s+chaud/iu, 'Maintien au chaud'],
  [/mode\s+vapeur|cuisson\s+vapeur|panier\s+vapeur/iu, 'Vapeur'],
  [/mode\s+manuel/iu, 'Manuel'],
];

/** Mode du Cookeo cité dans une étape (« Cuire en mode sous pression 35 minutes » → « Sous pression »), sinon null. */
export function cookeoMode(text: string): string | null {
  return COOKEO_MODES.find(([re]) => re.test(text))?.[1] ?? null;
}
