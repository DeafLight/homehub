// Logique du carnet côté front, sans DOM (testée) : recherche dans le carnet, lignes mises à l'échelle des portions
// et rangées par groupe, étapes avec leurs minuteurs et leur mode Cookeo, édition de notre version (lignes ajoutées,
// déplacées, portions par défaut qui entraînent les quantités), lien, texte ou page enregistrée reçus par
// « Partager », aperçu d'un import, droit de modifier, compte rendu d'une relecture de la page, signature des notes.
import { fold, formatIngredient } from '../../../shared/ingredients.ts';
import type { RecipeNote } from '../../../shared/recipe-notes.ts';
import { looksLikeRecipeText } from '../../../shared/recipe-text.ts';
import {
  cookeoMode,
  type ImportPreview,
  type IngredientLine,
  ingredientLines,
  type Recipe,
  type RecipeContent,
  type RecipeDraft,
  type RecipeStep,
  type RereadPart,
  type RecipeSummary,
  refreshLine,
  scaleFactor,
  type StepDuration,
  stepDurations,
  formatMinutes,
} from '../../../shared/recipes.ts';
import type { Member } from '../../../shared/types.ts';
import { formatAgo } from './format.ts';

// --- Carnet ---

/** Recettes dont le titre ou le site contient chaque mot cherché (sans accents) ; `cookeo` : seulement celles-là. */
export function searchRecipes(list: RecipeSummary[], query: string, cookeo = false): RecipeSummary[] {
  const words = fold(query).split(/\s+/u).filter(Boolean);
  return list.filter((r) => {
    if (cookeo && r.appliance !== 'cookeo') return false;
    const haystack = fold(`${r.title} ${r.site ?? ''}`);
    return words.every((w) => haystack.includes(w));
  });
}

/** « 4 personnes », « 12 galettes », « 1 portion ». */
export function servingsText(servings: number | null, unit: string | null): string | null {
  if (!servings) return null;
  if (unit) return `${servings} ${unit}`;
  return servings === 1 ? '1 personne' : `${servings} personnes`;
}

// --- Fiche ---

export type Group<T> = { section: string | null; items: T[] };

/** Éléments rangés par groupe, dans l'ordre (un groupe qui revient plus loin reste séparé). */
export function groupBySection<T extends { section: string | null }>(items: T[]): Group<T>[] {
  const groups: Group<T>[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

export type ShownLine = { id: string; text: string; optional: boolean };

/**
 * Lignes affichées pour `servings` portions : réécrites à l'échelle quand le nombre change ; telles qu'écrites
 * sinon (« Sel, poivre » analysé en deux ingrédients ne s'affiche qu'une fois).
 */
export function shownIngredients(content: RecipeContent, servings: number | null): Group<ShownLine>[] {
  const factor = scaleFactor(content.servings, servings);
  const seen = new Set<string>();
  const lines: (ShownLine & { section: string | null })[] = [];
  for (const line of content.ingredients) {
    if (factor === 1 || line.quantity === null) {
      // ligne d'origine affichée une fois, même analysée en plusieurs ingrédients
      const key = `${line.section}|${line.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({ id: line.id, text: line.text, optional: line.optional, section: line.section });
    } else {
      lines.push({ id: line.id, text: formatIngredient(line, factor), optional: line.optional, section: line.section });
    }
  }
  return groupBySection(lines);
}

export type ShownStep = RecipeStep & { number: number; durations: StepDuration[]; mode: string | null };

/** Étapes numérotées, avec les durées qu'elles citent (minuteur) et le mode Cookeo pour une recette Cookeo. */
export function shownSteps(content: RecipeContent): ShownStep[] {
  return content.steps.map((step, i) => ({
    ...step,
    number: i + 1,
    durations: stepDurations(step.text),
    mode: content.appliance === 'cookeo' ? cookeoMode(step.text) : null,
  }));
}

/** Longueur d'un nom de minuteur (serveur : TIMER_LABEL_MAX). */
const TIMER_LABEL_MAX = 30;

/** Nom du minuteur lancé depuis une étape (« Cuisson · ét. 3 · Galettes du… ») : il prend l'emoji de la cuisson. */
export function timerLabel(title: string, step: number): string {
  const prefix = `Cuisson · ét. ${step} · `;
  const room = TIMER_LABEL_MAX - prefix.length;
  const short = title.length > room ? `${title.slice(0, room - 1).trimEnd()}…` : title;
  return `${prefix}${short}`;
}

/** Durée d'un bouton de minuteur : « 35 min », « 1 h 30 », « 30 s ». */
export const durationText = (seconds: number) => (seconds < 60 ? `${seconds} s` : formatMinutes(Math.round(seconds / 60)));

/** Peut modifier notre version : un parent, ou qui a ajouté la recette (le serveur décide de toute façon). */
export const canEditRecipe = (member: Pick<Member, 'id' | 'parent'> | undefined, recipe: Pick<Recipe, 'addedBy'>) =>
  member !== undefined && (member.parent || recipe.addedBy.ownerId === member.id);

/** Compte rendu d'une relecture de la page : ce qui a été repris, ce que notre version a gardé. */
export function rereadMessage(updated: readonly RereadPart[], kept: readonly RereadPart[]): string {
  const list = (parts: readonly RereadPart[]) => parts.join(', ').replace(/, ([^,]*)$/u, ' et $1');
  const head = updated.length ? `Repris de la page : ${list(updated)}.` : 'Rien de nouveau sur la page.';
  return kept.length ? `${head} Notre version gardée pour : ${list(kept)}.` : head;
}

// --- Édition de notre version ---

let counter = 0;
export const newId = () => `n${Date.now().toString(36)}${(++counter).toString(36)}`;

export const emptyContent = (title = ''): RecipeContent => ({
  title,
  servings: 4,
  servingsUnit: null,
  ingredients: [],
  steps: [],
  tips: '',
  prepMinutes: null,
  cookMinutes: null,
  totalMinutes: null,
  appliance: null,
});

/** Lignes tapées d'un coup (une par ligne), analysées ; « sel, poivre » en donne deux. */
export const linesFromText = (text: string, section: string | null = null): IngredientLine[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => ingredientLines(l, section, newId));

/** Texte d'une ligne modifié : réanalysé, sauf correction à la main. */
export const editLineText = (line: IngredientLine, text: string): IngredientLine => refreshLine({ ...line, text });

/** Correction à la main (quantité, unité, nom) : elle l'emporte sur l'analyse, et la ligne est réécrite. */
export function correctLine(line: IngredientLine, fix: Partial<Pick<IngredientLine, 'quantity' | 'unit' | 'name'>>): IngredientLine {
  const next = { ...line, ...fix, manual: true };
  if (fix.name !== undefined) next.label = fix.name;
  if (next.quantity === null) next.unit = null;
  else next.unit ??= 'piece';
  next.quantityMax = null;
  return refreshLine({ ...next, text: formatIngredient(next) });
}

/** Déplace l'élément `index` d'un cran (-1 : vers le haut). */
export function move<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Nouvelles portions par défaut : les quantités suivent (lignes réécrites à la nouvelle échelle), sauf `keep` (les
 * quantités étaient déjà pour ce nombre, seul le chiffre était faux).
 */
export function changeServings(content: RecipeContent, servings: number, keep = false): RecipeContent {
  if (keep || !content.servings) return { ...content, servings };
  const factor = servings / content.servings;
  return {
    ...content,
    servings,
    ingredients: content.ingredients.map((line) => {
      if (line.quantity === null) return line;
      const scaled = { ...line, quantity: round(line.quantity * factor), quantityMax: line.quantityMax === null ? null : round(line.quantityMax * factor) };
      return { ...scaled, text: formatIngredient(scaled) };
    }),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Ce qu'il manque pour enregistrer, ou null. */
export function contentProblem(content: RecipeContent): string | null {
  if (!content.title.trim()) return 'Donne un titre à la recette';
  if (content.ingredients.length === 0 && content.steps.length === 0) return 'Ajoute au moins un ingrédient ou une étape';
  return null;
}

// --- Partage ---

/** Lien de recette reçu par « Partager » (champ url, ou premier lien du texte), sinon null. */
export function sharedLink(params: URLSearchParams): string | null {
  for (const key of ['url', 'text', 'title']) {
    const match = /https?:\/\/[^\s<>"']+/iu.exec(params.get(key) ?? '');
    if (match) return match[0].replace(/[).,;!?»]+$/u, '');
  }
  return null;
}

/**
 * Ce que « Partager » apporte côté recettes : une page enregistrée (déposée par le serveur, à réclamer), un texte
 * qui ressemble à une recette (copié d'une page), ou un lien ; null : une simple note pour une liste.
 */
export type SharedRecipe =
  | { kind: 'file'; id: string; title: string | null }
  | { kind: 'text'; text: string; link: string | null; title: string | null }
  | { kind: 'link'; link: string }
  | { kind: 'too-large' };

export function sharedRecipe(params: URLSearchParams): SharedRecipe | null {
  const title = params.get('title')?.trim() || null;
  const id = params.get('fichier');
  if (id) return { kind: 'file', id, title };
  if (params.get('erreur') === 'trop-lourd') return { kind: 'too-large' };
  const text = params.get('text') ?? '';
  const link = sharedLink(params);
  if (looksLikeRecipeText(text)) return { kind: 'text', text, link, title };
  return link ? { kind: 'link', link } : null;
}

/** Compte rendu d'un aperçu : ce qui a été compris, d'où. */
export function previewSummary(preview: ImportPreview['preview']): string {
  const { content } = preview;
  const from = preview.origin === 'text' ? 'le texte collé' : 'la page enregistrée';
  const count = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const parts = [count(content.ingredients.length, 'ingrédient', 'ingrédients'), count(content.steps.length, 'étape', 'étapes')];
  const servings = servingsText(content.servings, content.servingsUnit);
  if (servings) parts.push(servings);
  if (preview.photo) parts.push('photo');
  return `Compris dans ${from} : ${parts.join(', ')}. Vérifie et corrige avant d’enregistrer.`;
}

/**
 * Passage d'un écran à l'autre sans passer par l'adresse : le brouillon d'un import illisible (saisie à la main
 * préremplie), l'aperçu d'un texte collé ou d'une page enregistrée (à corriger avant d'enregistrer), et les portions
 * choisies sur une fiche (le mode cuisine les reprend). Oubliés au rechargement.
 */
export const handoff: { draft: RecipeDraft | null; preview: ImportPreview['preview'] | null; servings: Map<string, number> } = {
  draft: null,
  preview: null,
  servings: new Map(),
};

/**
 * Signature d'une note : « Tom · il y a 5 min », « · modifiée » si son texte a changé ; une note résolue dit qui l'a
 * résolue et quand (« Résolue par Alex hier à 18:30 »).
 */
export function noteMeta(note: RecipeNote, nameOf: (ownerId: string) => string, now: Date): string {
  const head = `${nameOf(note.by.ownerId)} · ${formatAgo(new Date(note.at), now)}${note.editedAt ? ' · modifiée' : ''}`;
  if (!note.resolvedAt) return head;
  return `${head} — résolue${note.resolvedBy ? ` par ${nameOf(note.resolvedBy.ownerId)}` : ''} ${formatAgo(new Date(note.resolvedAt), now)}`;
}
