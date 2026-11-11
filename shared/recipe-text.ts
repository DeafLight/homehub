// Recette retrouvée dans du texte copié d'une page (« Tout sélectionner », « Copier », parfois en mode lecture) ou
// partagé depuis une autre appli, quand HomeHub ne peut pas lire la page lui-même (site qui refuse la lecture). Le
// texte d'une page entière est bruité : menu, fil d'Ariane, notes et avis, boutons, publicités, commentaires,
// « Vous aimerez aussi », pied de page. On repère les titres usuels (« Ingrédients », « Préparation », « Étape 1 »…),
// le titre de la recette juste avant les ingrédients, les portions et les temps, et on s'arrête aux sections
// parasites. Tout se fait par règles, sans réseau ; le résultat est un aperçu que la personne corrige avant d'enregistrer.
import { fold, parseIngredient } from './ingredients.ts';
import { ingredientLines, RECIPE_LIMITS, type RecipeContent, type RecipeStep, yieldOf } from './recipes.ts';

/** Longueur maximale d'un texte collé (une page entière copiée tient largement dedans). */
export const RECIPE_TEXT_MAX = 200_000;

/**
 * Titre « Étape 3 », « Etape n° 3 : cuisson », « ÉTAPE 3. » : le numéro, et le texte qui suit sur la même ligne.
 * Commun au texte collé et aux étapes lues dans une page HTML (server/sources/recipe-page.ts).
 */
export const STEP_TITLE = /^(?:é|e)tape\s*(?:n°\s*)?(\d+)\s*(?:[.:)–-]\s*(.*))?$/iu;

export type TextRecipe = {
  content: RecipeContent;
  /** Premier lien http(s) trouvé dans le texte (la page d'origine), sinon null. */
  url: string | null;
};

// --- Reconnaissance des lignes ---

const DURATION = String.raw`(\d+)\s*(?:h|heures?)\s*(?:(\d+)\s*(?:min(?:utes?)?|mn)?)?|(\d+)\s*(?:min(?:utes?)?|mn)\.?`;
const DURATION_RE = new RegExp(`^(?:${DURATION})$`, 'iu');
const TIME_LABEL = String.raw`(?:temps\s+(?:de\s+)?)?(pr[ée]paration|pr[ée]p\.?|cuisson|total|temps\s+total|pr[êe]te?\s+en)`;
const TIME_RE = new RegExp(`^${TIME_LABEL}\\s*:?\\s*(?:${DURATION})$`, 'iu');
/** Libellé de temps seul sur sa ligne, la durée sur la suivante (mise en page en deux rangées). */
const TIME_LABEL_RE = new RegExp(`^${TIME_LABEL}\\s*:?$`, 'iu');

/** « 1 h 15 », « 45 min », « 2 heures » → minutes ; null si ce n'est pas une durée. */
export function durationMinutes(text: string): number | null {
  const match = DURATION_RE.exec(text.trim());
  if (!match) return null;
  const minutes = match[3] !== undefined ? Number(match[3]) : Number(match[1]) * 60 + Number(match[2] ?? 0);
  return minutes > 0 && minutes < 10_000 ? minutes : null;
}

const PEOPLE_WORDS = String.raw`personnes?|pers\.?|parts?|portions?|couverts?|convives?`;
const SERVINGS_RES = [
  new RegExp(String.raw`^(?:pour\s+)?(\d+(?:\s*(?:à|-|–)\s*\d+)?\s*(?:${PEOPLE_WORDS}))\b.*$`, 'iu'),
  new RegExp(String.raw`^(?:portions?|nombre\s+de\s+(?:personnes|parts|portions)|rendement|quantit[ée])\s*:?\s*(\d+.*)$`, 'iu'),
  // « Pour 12 crêpes » : deux ou trois mots au plus, sinon c'est une phrase.
  /^pour\s+(\d+\s+\p{L}+(?:\s+\p{L}+)?)\s*:?$/iu,
];

const INGREDIENTS_RE = /^(?:les\s+)?ingr[ée]dients?\b\s*(.*)$/iu;
const STEPS_RE =
  /^(?:la\s+|les\s+)?(?:pr[ée]paration(?:\s+de\s+la\s+recette)?|[ée]tapes?(?:\s+de\s+(?:la\s+)?(?:pr[ée]paration|recette))?|instructions?|d[ée]roul[ée](?:ment)?(?:\s+de\s+la\s+recette)?|m[ée]thode|r[ée]alisation|recette|marche\s+à\s+suivre|progression)\s*:?$/iu;
const TIPS_RE = /^(?:nos\s+|mes\s+|les\s+|le\s+|l['’])?(?:astuces?|conseils?|notes?|remarques?|variantes?|bon\s+à\s+savoir)(?:\s+(?:du\s+chef|de\s+\p{L}+))?\s*:?$/iu;
const SKIP_RE = /^(?:les\s+|le\s+)?(?:ustensiles?|mat[ée]riel(?:\s+n[ée]cessaire)?|valeurs?\s+nutritionnelles?|informations?\s+nutritionnelles?|nutrition|allerg[èe]nes?|calories)\b.{0,30}$/iu;
/** Sections parasites : la recette est finie quand l'une d'elles commence. */
const STOP_RE = new RegExp(
  '^(?:' +
    [
      String.raw`\d+\s+(?:commentaires?|avis|r[ée]ponses?)`,
      String.raw`commentaires?`,
      String.raw`avis(?:\s+des\s+\p{L}+)?`,
      String.raw`(?:laisser|ajouter|[ée]crire|donner|donnez)\s+(?:un|votre)\s+(?:commentaire|avis)`,
      String.raw`votre\s+avis`,
      String.raw`vous\s+aimerez\s+(?:aussi|[ée]galement|peut-[êe]tre)`,
      String.raw`(?:[àa]\s+)?d[ée]couvrir\s+aussi`,
      String.raw`(?:[àa]\s+)?lire\s+aussi`,
      String.raw`voir\s+aussi`,
      String.raw`recettes?\s+(?:similaires|associ[ée]es|li[ée]es|du\s+moment|populaires|de\s+saison)`,
      String.raw`(?:d['’]autres|plus\s+de|nos\s+autres|nos\s+derni[èe]res|les\s+derni[èe]res)\s+recettes`,
      String.raw`dans\s+la\s+m[êe]me\s+cat[ée]gorie`,
      String.raw`articles?\s+(?:similaires|li[ée]s)`,
      String.raw`newsletter`,
      String.raw`(?:inscrivez|abonnez)-vous`,
      String.raw`suivez-nous`,
      String.raw`mentions\s+l[ée]gales`,
      String.raw`politique\s+de\s+confidentialit[ée]`,
      String.raw`conditions\s+g[ée]n[ée]rales`,
      String.raw`plan\s+du\s+site`,
      String.raw`tous\s+droits\s+r[ée]serv[ée]s`,
      String.raw`©`,
      String.raw`copyright`,
      String.raw`partager\s+(?:cette\s+recette|sur)`,
      String.raw`qui\s+sommes-nous`,
      String.raw`mots-cl[ée]s`,
      String.raw`tags?\s*:`,
    ].join('|') +
    ')',
  'iu',
);
/** Boutons et mentions sans contenu, où qu'ils soient. */
const NOISE_RE =
  /^(?:imprimer(?:\s+la\s+recette)?|partager|enregistrer|sauvegarder|ajouter\s+(?:à|aux)\s+.{1,30}|j['’]ai\s+fait\s+(?:cette\s+)?recette|voir\s+la\s+vid[ée]o|lire\s+la\s+suite|publicit[ée]|annonce|sponsoris[ée]|contenu\s+sponsoris[ée]|se\s+connecter|connexion|s['’]inscrire|menu|rechercher|recherche|fermer|retour\s+en\s+haut|accueil|tout\s+cocher|afficher\s+plus|voir\s+plus|facile|tr[èe]s\s+facile|moyen(?:ne)?|difficile|bon\s+march[ée]|assez\s+cher|cher|co[ûu]t\s+moyen|niveau\s*:.*|difficult[ée]\s*:.*|co[ûu]t\s*:.*|budget\s*:.*|personnes?|parts?|portions?)$/iu;
const RATING_RE = /^\d+(?:[.,]\d+)?\s*(?:\/\s*5|sur\s+5|étoiles?)|^\(?\d+\s+(?:avis|votes?|notes?|commentaires?)\)?$/iu;
const URL_RE = /https?:\/\/[^\s<>"']+/iu;
/** Numéro d'étape en tête de ligne (« 1. », « 2) », « 3 - ») suivi du texte. */
const NUMBERED_RE = /^(\d{1,2})\s*[.)–-]\s+(\S.*)$/u;

type Kind = 'ingredients' | 'steps' | 'step' | 'tips' | 'skip' | 'stop' | 'time' | 'servings' | 'noise' | 'text';
type Line = { text: string; kind: Kind; /** Numéro (étape) ; minutes (temps). */ value?: number; rest?: string; field?: 'prep' | 'cook' | 'total' };

const words = (text: string) => text.split(/\s+/u).filter(Boolean).length;
const onlySymbols = (text: string) => !/[\p{L}\p{N}]/u.test(text);

function timeField(label: string): Line['field'] {
  const folded = fold(label);
  if (folded.startsWith('prep')) return 'prep';
  if (folded.startsWith('cuisson')) return 'cook';
  return 'total';
}

function classify(text: string): Line {
  const time = TIME_RE.exec(text);
  if (time) {
    const minutes = durationMinutes(text.slice(text.search(/\d/u)));
    if (minutes !== null) return { text, kind: 'time', value: minutes, field: timeField(time[1]) };
  }
  const step = STEP_TITLE.exec(text);
  if (step) return { text, kind: 'step', value: Number(step[1]), rest: step[2]?.trim() ?? '' };
  const ingredients = INGREDIENTS_RE.exec(text);
  if (ingredients && words(text) <= 8 && !/[.!?]$/u.test(text)) return { text, kind: 'ingredients', rest: ingredients[1] };
  if (STEPS_RE.test(text)) return { text, kind: 'steps' };
  if (TIPS_RE.test(text)) return { text, kind: 'tips' };
  if (SKIP_RE.test(text)) return { text, kind: 'skip' };
  if (text.length <= 80 && STOP_RE.test(text)) return { text, kind: 'stop' };
  if (SERVINGS_RES.some((re) => re.test(text)) && words(text) <= 6) return { text, kind: 'servings' };
  if (onlySymbols(text) || NOISE_RE.test(text) || RATING_RE.test(text) || URL_RE.exec(text)?.[0] === text) return { text, kind: 'noise' };
  return { text, kind: 'text' };
}

/** Ligne qui n'est qu'une quantité (« 200 g », « 3 », « 1/2 ») : le nom de l'ingrédient est sur la ligne suivante. */
const quantityOnly = (text: string) => /^(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔])\s*(?:[a-zA-Zàé.]{1,12}(?:\s+(?:à|a)\s+(?:soupe|café|caf[ée]))?)?$/u.test(text) && !/[.!?]$/u.test(text) && !/^\d+\s*(?:personnes?|parts?)$/iu.test(text);

/**
 * Lignes du texte, nettoyées (puces, espaces insécables) et recollées quand la page les a coupées : « 4 » puis
 * « personnes » ; « Préparation » puis « 15 min ». (« 200 g » puis « farine » se recolle parmi les ingrédients.)
 */
function linesOf(raw: string): string[] {
  const cleaned = raw
    .slice(0, RECIPE_TEXT_MAX)
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((l) =>
      l
        .replace(/[\s  ]+/gu, ' ')
        .replace(/^(?:[•·▪▢☐☑✓✔●○◦*+]|-(?=\s))\s*/u, '')
        .trim(),
    )
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const line = cleaned[i];
    const next = cleaned[i + 1];
    if (next !== undefined) {
      if (/^\d+$/u.test(line) && new RegExp(`^(?:${PEOPLE_WORDS})$`, 'iu').test(next)) {
        out.push(`${line} ${next}`);
        i++;
        continue;
      }
      if (TIME_LABEL_RE.test(line) && durationMinutes(next) !== null) {
        out.push(`${line.replace(/\s*:$/u, '')} : ${next}`);
        i++;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

// --- Titre ---

/** Ligne qui peut être le titre d'une recette : courte, pas une phrase, pas un fil d'Ariane ni une mention. */
function titleLike(line: Line): boolean {
  if (line.kind !== 'text') return false;
  const { text } = line;
  if (text.length < 3 || text.length > 120 || words(text) > 16) return false;
  if (/[>›»|]|\s\/\s/u.test(text)) return false; // fil d'Ariane, « Recette | Site »
  if (/[.!?…:]$/u.test(text) && words(text) > 4) return false; // une phrase d'introduction
  if (/^(?:par|publi[ée]e?|mise?\s+à\s+jour|le\s+\d|il\s+y\s+a)(?=\s|$)/iu.test(text)) return false; // auteur, date
  if (/^[\w.-]+\.[a-z]{2,}$/iu.test(text)) return false; // nom du site
  if (/^\d/u.test(text)) return false;
  return /\p{L}{3}/u.test(text);
}

/** « Recette de la tarte aux pommes » → « Tarte aux pommes » ; « Tarte - Mon blog » (titre partagé) → « Tarte ». */
function cleanTitle(text: string): string {
  let title = text.replace(/\s+[-–|·]\s+[^-–|·]{2,40}$/u, '').trim();
  const stripped = title.replace(/^recette\s+(?:de\s+(?:la\s+|l['’])?|du\s+|des\s+|d['’])?/iu, '');
  if (stripped !== title && words(stripped) >= 2) title = stripped[0].toUpperCase() + stripped.slice(1);
  return title.slice(0, RECIPE_LIMITS.title);
}

// --- Découpage ---

/** Première ligne d'ingrédients plausible : un titre « Ingrédients » suivi de quantités, sinon une suite de quantités. */
function ingredientsStart(lines: Line[]): { index: number; heading: boolean } | null {
  const hasQuantity = (l: Line) => l.kind === 'text' && parseIngredient(l.text).quantity !== null;
  const headings = lines.flatMap((l, i) => (l.kind === 'ingredients' ? [i] : []));
  const sectionOf = (i: number) => {
    const next = lines.findIndex((l, j) => j > i && (l.kind === 'ingredients' || l.kind === 'steps' || l.kind === 'stop'));
    return lines.slice(i + 1, Math.min(i + 14, next === -1 ? lines.length : next));
  };
  const scored = headings.find((i) => sectionOf(i).filter(hasQuantity).length >= 2);
  if (scored !== undefined) return { index: scored, heading: true };
  if (headings.length > 0) return { index: headings[0], heading: true };
  for (let i = 0; i + 2 < lines.length; i++) {
    if (hasQuantity(lines[i]) && hasQuantity(lines[i + 1]) && hasQuantity(lines[i + 2])) return { index: i, heading: false };
  }
  return null;
}

/** Une ligne d'étape plutôt que d'ingrédient : une vraie phrase. */
const sentence = (text: string) => text.length > 90 || (words(text) >= 8 && /[.!]$/u.test(text));

/**
 * Lit une recette dans un texte copié d'une page. `title` : titre reçu à côté du texte (champ « title » d'un
 * partage), pris s'il n'y a rien de mieux dans le texte.
 */
export function parseRecipeText(raw: string, { nextId, title: sharedTitle = '' }: { nextId: () => string; title?: string }): TextRecipe {
  const url = URL_RE.exec(raw)?.[0].replace(/[).,;!?»]+$/u, '') ?? null;
  const lines = linesOf(raw).map(classify);

  const start = ingredientsStart(lines);
  const stepsHeading = lines.findIndex((l, i) => (l.kind === 'steps' || (l.kind === 'step' && l.value === 1)) && (start === null || i > start.index));
  const begin = start?.index ?? (stepsHeading === -1 ? lines.length : stepsHeading);

  // Titre : en remontant depuis le début de la recette, la première ligne qui y ressemble (les temps, notes,
  // difficulté et phrases d'introduction sont sautés) ; à défaut, le titre partagé.
  let title = '';
  for (let i = begin - 1; i >= Math.max(0, begin - 15) && !title; i--) {
    if (lines[i].kind === 'stop') break;
    if (titleLike(lines[i])) title = lines[i].text;
  }
  title = cleanTitle(title || sharedTitle.trim()) || 'Recette';

  // Fin de la recette : la première section parasite après son début.
  const stopAt = lines.findIndex((l, i) => i > begin && l.kind === 'stop');
  const end = stopAt === -1 ? lines.length : stopAt;

  // Portions et temps : autour de la recette (avant les ingrédients, ou en bas des étapes).
  const portions: { servings: number | null; unit: string | null } = { servings: null, unit: null };
  const times: Partial<Record<NonNullable<Line['field']>, number>> = {};
  const servingsFrom = (text: string) => {
    if (portions.servings !== null || !/\d/u.test(text)) return;
    const match = SERVINGS_RES.map((re) => re.exec(text)).find(Boolean);
    const found = yieldOf(match ? match[1] : text.replace(/^[\s(:]*(?:pour\s+)?/iu, '').replace(/\)\s*$/u, ''));
    if (found.servings !== null) Object.assign(portions, found);
  };
  for (const line of lines.slice(Math.max(0, begin - 15), end)) {
    if (line.kind === 'time' && line.field && times[line.field] === undefined) times[line.field] = line.value;
    if (line.kind === 'servings') servingsFrom(line.text);
    if (line.kind === 'ingredients' && line.rest) servingsFrom(line.rest);
  }

  // Ingrédients, étapes, astuces : on suit les titres de section.
  const ingredientTexts: { text: string; section: string | null }[] = [];
  const steps: { text: string; marked: boolean }[] = [];
  const tips: string[] = [];
  let mode: 'ingredients' | 'steps' | 'tips' | 'skip' | 'none' = start ? 'ingredients' : 'steps';
  let section: string | null = null;
  const from = start ? (start.heading ? start.index + 1 : start.index) : stepsHeading === -1 ? lines.length : stepsHeading;
  const body = lines.slice(from, end);
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const { kind } = line;
    let { text } = line;
    if (kind === 'ingredients') {
      if (steps.length > 0) break; // une autre recette commence
      mode = 'ingredients';
      continue;
    }
    if (kind === 'steps') {
      mode = 'steps';
      continue;
    }
    if (kind === 'step') {
      mode = 'steps';
      steps.push({ text: line.rest ?? '', marked: true });
      continue;
    }
    if (kind === 'tips') {
      mode = 'tips';
      continue;
    }
    if (kind === 'skip') {
      mode = 'skip';
      continue;
    }
    if (kind !== 'text') continue;
    if (mode === 'ingredients') {
      const numbered = NUMBERED_RE.exec(text);
      if ((numbered && words(numbered[2]) >= 4) || (ingredientTexts.length > 0 && sentence(text))) {
        // Pas de titre avant les étapes : la première phrase les ouvre.
        mode = 'steps';
      } else {
        if (text.length > 160) continue;
        const next = body[i + 1];
        if (quantityOnly(text) && next?.kind === 'text' && !/\d/u.test(next.text) && words(next.text) <= 8) {
          text = `${text} ${next.text}`; // « 2 » puis « œufs »
          i++;
        }
        const parsed = parseIngredient(text);
        if (parsed.quantity === null && words(text) <= 8 && (/:$/u.test(text) || /^pour\s+(?:la|le|les|l['’]|un|une|des)\s/iu.test(text))) {
          section = text.replace(/\s*:$/u, '').slice(0, RECIPE_LIMITS.section);
          continue;
        }
        ingredientTexts.push({ text: text.slice(0, RECIPE_LIMITS.line), section });
        continue;
      }
    }
    if (mode === 'steps') {
      const numbered = NUMBERED_RE.exec(text);
      const last = steps.at(-1);
      if (numbered) steps.push({ text: numbered[2], marked: true });
      else if (/^\d{1,2}$/u.test(text)) steps.push({ text: '', marked: true });
      else if (last?.marked) last.text = last.text ? `${last.text}\n${text}` : text;
      else steps.push({ text, marked: false });
    } else if (mode === 'tips') tips.push(text);
  }

  const ingredients = ingredientTexts.slice(0, RECIPE_LIMITS.ingredients).flatMap((l) => ingredientLines(l.text, l.section, nextId));
  const stepList: RecipeStep[] = steps
    .filter((s) => s.text.trim())
    .slice(0, RECIPE_LIMITS.steps)
    .map((s) => ({ id: nextId(), text: s.text.trim().slice(0, RECIPE_LIMITS.step), section: null }));
  const prepMinutes = times.prep ?? null;
  const cookMinutes = times.cook ?? null;
  const totalMinutes = times.total ?? (prepMinutes || cookMinutes ? (prepMinutes ?? 0) + (cookMinutes ?? 0) : null);
  const clues = [title, sharedTitle, ...stepList.map((s) => s.text)].join(' ');
  return {
    url,
    content: {
      title,
      servings: portions.servings,
      servingsUnit: portions.unit,
      ingredients,
      steps: stepList,
      tips: tips.join('\n').slice(0, RECIPE_LIMITS.tips),
      prepMinutes,
      cookMinutes,
      totalMinutes,
      appliance: /cookeo/iu.test(clues) ? 'cookeo' : null,
    },
  };
}

/** Texte partagé qui ressemble à une recette (et non à une simple note pour une liste) : des ingrédients, ou des étapes. */
export function looksLikeRecipeText(raw: string): boolean {
  if (raw.split('\n').filter((l) => l.trim()).length < 4) return false;
  const { content } = parseRecipeText(raw, { nextId: () => '' });
  return content.ingredients.length >= 2 || (content.ingredients.length >= 1 && content.steps.length >= 1);
}
