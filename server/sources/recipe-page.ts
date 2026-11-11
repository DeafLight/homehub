// Lecteur générique d'une page de recette : les données structurées schema.org `Recipe` que publient Marmiton, Jow,
// Moulinex (Cookeo) et la plupart des sites de cuisine, en JSON-LD (au premier niveau, dans un tableau, dans un
// `@graph`) ou, à défaut, en microdata. Rien de propre à un site : seulement des normalisations (portions,
// unités, mode Cookeo dans les étapes), et les étapes lues sous des titres « Étape 1 »… quand le JSON-LD n'en a pas. Sans recette lisible : le titre de la page, pour préremplir la saisie à la main.
import { ingredientLines, isoMinutes, RECIPE_LIMITS, type RecipeContent, type RecipeStep, yieldOf } from '../../shared/recipes.ts';

export type ReadRecipe =
  | { found: true; content: RecipeContent; imageUrl: string | null; site: string }
  | { found: false; title: string | null; site: string };

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  agrave: 'à', acirc: 'â', auml: 'ä', ccedil: 'ç', icirc: 'î', iuml: 'ï', ocirc: 'ô', ouml: 'ö', ugrave: 'ù',
  ucirc: 'û', uuml: 'ü', oelig: 'œ', OElig: 'Œ', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—', deg: '°',
  frac12: '½', frac14: '¼', frac34: '¾', times: '×', middot: '·', bull: '•',
};

/** Entités HTML (« &eacute; », « &#39; », « &#x2019; ») remplacées par leurs caractères. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/giu, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code] ?? whole;
  });
}

/** Texte d'un fragment HTML : balises retirées (les fins de paragraphe et de ligne gardées), entités décodées. */
export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/giu, ' ')
      .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/giu, '\n')
      .replace(/<[^>]+>/gu, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/[\s ]+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const oneLine = (value: unknown, max: number) => (typeof value === 'string' ? htmlText(value).replace(/\n/gu, ' ').slice(0, max).trim() : '');

const KNOWN_SITES: Record<string, string> = {
  'marmiton.org': 'Marmiton',
  'jow.fr': 'Jow',
  'moulinex.fr': 'Moulinex',
  'cookeo.fr': 'Cookeo',
  'mycookeo.fr': 'MyCookeo',
  '750g.com': '750g',
  'cuisineaz.com': 'CuisineAZ',
  'cuisineactuelle.fr': 'Cuisine Actuelle',
  'journaldesfemmes.fr': 'Journal des Femmes',
  'ricardocuisine.com': 'Ricardo',
};

/** Nom lisible du site : connu, sinon `og:site_name`, sinon l'hôte sans « www. ». */
export function siteName(url: string, html = ''): string {
  const host = new URL(url).hostname.replace(/^www\./u, '');
  const known = Object.entries(KNOWN_SITES).find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  if (known) return known[1];
  return oneLine(metaContent(html, 'og:site_name'), 60) || host;
}

function metaContent(html: string, property: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
    const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1];
    if (name?.toLowerCase() !== property) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/iu.exec(tag);
    if (content) return decodeEntities(content[1] ?? content[2] ?? '');
  }
  return null;
}

// --- JSON-LD ---

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const typesOf = (node: Json) => [node['@type']].flat().map((t) => String(t).replace(/^https?:\/\/schema\.org\//u, ''));

/** Premier nœud `Recipe` d'un document JSON-LD (tableaux, `@graph`, `mainEntity` parcourus). */
function findRecipe(node: unknown, depth = 0): Json | null {
  if (depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipe(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(node)) return null;
  if (typesOf(node).includes('Recipe')) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const found = findRecipe(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function jsonLdRecipe(html: string): Json | null {
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/giu)) {
    const raw = match[1].trim().replace(/^<!\[CDATA\[|\]\]>$/gu, '').trim();
    try {
      const found = findRecipe(JSON.parse(raw));
      if (found) return found;
    } catch {
      // bloc illisible (virgule en trop…) : on passe au suivant
    }
  }
  return null;
}

// --- Microdata (sites plus anciens) ---

function microdataRecipe(html: string): Json | null {
  const start = html.search(/itemtype\s*=\s*["']https?:\/\/schema\.org\/Recipe["']/iu);
  if (start === -1) return null;
  const scope = html.slice(start);
  const props: Record<string, string[]> = {};
  const add = (name: string, value: string) => (props[name] ??= []).push(value);
  for (const match of scope.matchAll(/<(\w+)\b([^>]*\bitemprop\s*=\s*["']([^"']+)["'][^>]*)>/giu)) {
    const [whole, tag, attrs, names] = match;
    const attr = (name: string) => new RegExp(String.raw`\b${name}\s*=\s*["']([^"']*)["']`, 'iu').exec(attrs)?.[1];
    let value = attr('content') ?? attr('datetime') ?? (/^(img|link|a)$/iu.test(tag) ? (attr('src') ?? attr('href')) : undefined);
    if (value === undefined) {
      const rest = scope.slice((match.index ?? 0) + whole.length);
      const end = rest.search(new RegExp(String.raw`</${tag}\s*>`, 'iu'));
      value = end === -1 ? '' : rest.slice(0, end);
    }
    for (const name of names.split(/\s+/u)) add(name, decodeEntities(value));
  }
  if (!props.name && !props.recipeIngredient && !props.ingredients) return null;
  return {
    name: props.name?.[0],
    recipeYield: props.recipeYield?.[0],
    recipeIngredient: props.recipeIngredient ?? props.ingredients,
    recipeInstructions: props.recipeInstructions?.join('\n'),
    image: props.image?.[0],
    prepTime: props.prepTime?.[0],
    cookTime: props.cookTime?.[0],
    totalTime: props.totalTime?.[0],
  };
}

// --- Normalisation ---

function imageOf(value: unknown, base: string): string | null {
  const first = [value].flat()[0];
  const raw = typeof first === 'string' ? first : isObject(first) ? (first.url ?? first.contentUrl) : null;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(decodeEntities(raw.trim()), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

type RawStep = { text: string; section: string | null };

/** Étapes : texte, liste de textes, HowToStep, HowToSection (groupes nommés), ou HTML en un seul bloc. */
function stepsOf(value: unknown, section: string | null = null, depth = 0): RawStep[] {
  if (depth > 4 || value === undefined || value === null) return [];
  if (typeof value === 'string') {
    const text = htmlText(value);
    // Un seul bloc : une étape par paragraphe ou par ligne.
    return text.split('\n').map((t) => t.replace(/^\d+[.)]\s+/u, '').trim()).filter(Boolean).map((t) => ({ text: t, section }));
  }
  if (Array.isArray(value)) return value.flatMap((item) => stepsOf(item, section, depth + 1));
  if (!isObject(value)) return [];
  const types = typesOf(value);
  if (types.includes('HowToSection') || (Array.isArray(value.itemListElement) && !value.text)) {
    const name = oneLine(value.name, RECIPE_LIMITS.section) || section;
    return stepsOf(value.itemListElement, name, depth + 1);
  }
  const text = typeof value.text === 'string' ? value.text : typeof value.name === 'string' ? value.name : '';
  const clean = htmlText(text);
  return clean ? [{ text: clean, section }] : [];
}

// --- Étapes écrites seulement dans la page ---

// Balises sans contenu, et balises dont la fermeture est facultative (<li>, <p>… souvent laissées ouvertes) : ni les
// unes ni les autres ne comptent dans la profondeur.
const UNCOUNTED_TAGS = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr|li|p|dt|dd|option|tr|td|th)$/iu;

/** Début d'un fragment jusqu'à la sortie de l'élément qui le contient (une fermeture de trop). */
function withinParent(fragment: string): string {
  let depth = 0;
  for (const match of fragment.matchAll(/<(\/?)([a-z][\w-]*)\b[^>]*?(\/?)>/giu)) {
    const [, closing, tag, selfClosing] = match;
    if (UNCOUNTED_TAGS.test(tag)) continue;
    if (closing) {
      if (--depth < 0) return fragment.slice(0, match.index);
    } else if (!selfClosing) depth++;
  }
  return fragment;
}

/**
 * Étapes que la page n'écrit que pour l'œil (des blogs ne donnent dans le JSON-LD que titre et ingrédients) : des
 * titres « Étape 1 », « Étape 2 »… numérotés à la suite depuis 1, chacun suivi de son texte jusqu'au titre suivant
 * ou à la sortie du bloc qui le contient. Un titre « Étape 2 : cuisson » garde « cuisson » en tête de l'étape.
 */
export function pageSteps(html: string): RawStep[] {
  const body = html.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/giu, ' ');
  const headings = [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/giu)];
  const steps: RawStep[] = [];
  let next = 1;
  for (const [i, heading] of headings.entries()) {
    const title = /^(?:é|e)tape\s*(?:n°\s*)?(\d+)\s*(?:[.:)–-]\s*(.*))?$/iu.exec(oneLine(heading[2], 200));
    if (!title) continue;
    if (Number(title[1]) !== next) {
      if (next > 1) break; // numérotation rompue : la suite n'est plus la recette
      continue;
    }
    next++;
    const start = (heading.index ?? 0) + heading[0].length;
    const fragment = withinParent(body.slice(start, headings[i + 1]?.index ?? body.length))
      .replace(/\s+/gu, ' ') // les retours à la ligne du source ne sont que des espaces
      .replace(/<(p|li|tr)\b[^>]*>/giu, '<br>'); // paragraphes et puces laissés ouverts
    const text = [title[2]?.trim(), htmlText(fragment)].filter(Boolean).join('\n');
    if (text) steps.push({ text, section: null });
  }
  return steps;
}

function ingredientTexts(value: unknown): string[] {
  return [value]
    .flat()
    .filter((v): v is string => typeof v === 'string')
    .map((v) => oneLine(v, RECIPE_LIMITS.line))
    .filter(Boolean);
}

const textOf = (value: unknown) => [value].flat().filter((v) => typeof v === 'string').join(' ');

/** Contenu d'un nœud `Recipe`, dans la forme du carnet. */
export function recipeContent(
  node: Json,
  { pageTitle = '', nextId, html = '' }: { pageTitle?: string; nextId: () => string; /** La page, pour les étapes que le JSON-LD ne donne pas. */ html?: string },
): RecipeContent {
  const title = oneLine(node.name, RECIPE_LIMITS.title) || oneLine(node.headline, RECIPE_LIMITS.title) || pageTitle || 'Recette';
  const { servings, unit } = yieldOf(node.recipeYield ?? node.yield);
  const ingredients = ingredientTexts(node.recipeIngredient ?? node.ingredients)
    .slice(0, RECIPE_LIMITS.ingredients)
    .flatMap((text) => ingredientLines(text, null, nextId));
  const readSteps = stepsOf(node.recipeInstructions);
  const steps: RecipeStep[] = (readSteps.length > 0 ? readSteps : pageSteps(html))
    .slice(0, RECIPE_LIMITS.steps)
    .map((s) => ({ id: nextId(), text: s.text.slice(0, RECIPE_LIMITS.step), section: s.section }));
  const prepMinutes = isoMinutes(node.prepTime);
  const cookMinutes = isoMinutes(node.cookTime);
  const totalMinutes = isoMinutes(node.totalTime) ?? (prepMinutes || cookMinutes ? (prepMinutes ?? 0) + (cookMinutes ?? 0) : null);
  const tool = [node.tool].flat().map((t) => (isObject(t) ? t.name : t));
  const clues = [title, pageTitle, textOf(node.keywords), textOf(node.recipeCategory), textOf(tool), ...steps.map((s) => s.text)].join(' ');
  const appliance = /cookeo/iu.test(clues) ? 'cookeo' : null;
  return { title, servings, servingsUnit: unit, ingredients, steps, tips: '', prepMinutes, cookMinutes, totalMinutes, appliance };
}

/** Lit la recette d'une page HTML (adresse finale `url`, pour les liens relatifs et le nom du site). */
export function readRecipePage(html: string, url: string, nextId: () => string): ReadRecipe {
  const site = siteName(url, html);
  const pageTitle = oneLine(metaContent(html, 'og:title') ?? /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? '', RECIPE_LIMITS.title);
  const node = jsonLdRecipe(html) ?? microdataRecipe(html);
  if (!node) return { found: false, title: pageTitle || null, site };
  const content = recipeContent(node, { pageTitle, nextId, html });
  if (content.ingredients.length === 0 && content.steps.length === 0) return { found: false, title: content.title, site };
  return { found: true, content, imageUrl: imageOf(node.image, url) ?? imageOf(metaContent(html, 'og:image'), url), site };
}

/** Texte d'une page reçue en octets, d'après le jeu de caractères annoncé (en-tête ou balise meta), UTF-8 sinon. */
export function decodePage(body: Uint8Array, contentType: string): string {
  const head = new TextDecoder('latin1').decode(body.slice(0, 2048));
  const charset = /charset\s*=\s*["']?([\w-]+)/iu.exec(contentType)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/iu.exec(head)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}
