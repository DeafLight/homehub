// Analyse locale d'une ligne d'ingrédient de recette, par règles (aucun service externe) : « 2 gros oignons émincés »
// → quantité 2, pièce, nom « oignon », précisions « gros, émincés ». Sert à mettre les quantités à l'échelle des
// portions, et plus tard à regrouper un même ingrédient entre recettes (clé normalisée, rayon). Partagé entre le
// serveur (import) et le front (édition de notre version).

export const UNITS = [
  'g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'cs', 'cc', 'pincee', 'gousse', 'tranche', 'sachet', 'boite', 'brin', 'branche',
  'feuille', 'botte', 'bouquet', 'verre', 'tasse', 'bol', 'noix', 'poignee', 'filet', 'morceau', 'pot', 'cube', 'paquet',
  'rouleau', 'tablette', 'barquette', 'louche', 'piece',
] as const;
export type Unit = (typeof UNITS)[number];

export type ParsedIngredient = {
  /** Quantité (borne basse d'une plage « 2 à 3 ») ; null : « sel », « quelques ». */
  quantity: number | null;
  /** Borne haute d'une plage, sinon null. */
  quantityMax: number | null;
  /** Unité ; « pièce » pour « 2 oignons » ; null sans quantité. */
  unit: Unit | null;
  /** Ce qui suit la quantité et l'unité, tel qu'écrit (« gros oignons émincés »), pour réécrire la ligne. */
  label: string;
  /** Nom de l'ingrédient, au singulier et sans précisions (« oignon »). */
  name: string;
  /** Précisions retirées du nom (« gros, émincés »). */
  notes: string;
  optional: boolean;
};

// --- Unités : formes reconnues, de la plus longue à la plus courte quand l'une contient l'autre ---

const SPOON = String.raw`(?:cuill[eè]res?|cuiller[eé]es?|cuill?\.?|c\.?)`;
const UNIT_FORMS: [Unit, string][] = [
  ['cs', String.raw`${SPOON}\s*(?:à|a)\.?\s*(?:soupe|s\.?)|c\.?à\.?s\.?|càs|cas(?=\s+d)|cs`],
  ['cc', String.raw`${SPOON}\s*(?:à|a)\.?\s*(?:caf[ée]|c\.?)|c\.?à\.?c\.?|càc|cac(?=\s+d)|cc`],
  ['kg', String.raw`kg|kilos?(?:grammes?)?`],
  ['mg', String.raw`mg|milligrammes?`],
  ['g', String.raw`grammes?|gr\.?|g`],
  ['ml', String.raw`ml|millilitres?`],
  ['cl', String.raw`cl|centilitres?`],
  ['dl', String.raw`dl|d[ée]cilitres?`],
  ['l', String.raw`litres?|l`],
  ['pincee', String.raw`pinc[ée]es?`],
  ['gousse', String.raw`gousses?`],
  ['tranche', String.raw`tranches?`],
  ['sachet', String.raw`sachets?`],
  ['boite', String.raw`bo[iî]tes?`],
  ['brin', String.raw`brins?`],
  ['branche', String.raw`branches?`],
  ['feuille', String.raw`feuilles?`],
  ['botte', String.raw`bottes?`],
  ['bouquet', String.raw`bouquets?`],
  ['verre', String.raw`verres?`],
  ['tasse', String.raw`tasses?`],
  ['bol', String.raw`bols?`],
  ['noix', String.raw`noix`],
  ['poignee', String.raw`poign[ée]es?`],
  ['filet', String.raw`filets?`],
  ['morceau', String.raw`morceaux?`],
  ['pot', String.raw`pots?`],
  ['cube', String.raw`cubes?`],
  ['paquet', String.raw`paquets?`],
  ['rouleau', String.raw`rouleaux?`],
  ['tablette', String.raw`tablettes?`],
  ['barquette', String.raw`barquettes?`],
  ['louche', String.raw`louches?`],
];
/** Fin d'une unité : espace, ponctuation, fin de ligne, ou « d' » collé. */
const UNIT_END = String.raw`(?=$|[\s,;:()]|d['’])`;
const UNIT_RES = UNIT_FORMS.map(([unit, form]) => [unit, new RegExp(String.raw`^(?:${form})${UNIT_END}\.?\s*`, 'iu')] as const);

/** Un filet n'est une unité que pour un liquide (« un filet d'huile ») ; « 2 filets de poulet » sont des pièces. */
const LIQUID = /^(huile|vinaigre|citron|jus|lait|cr[eè]me|sauce|miel|sirop|vin|eau|soja|tabasco|cognac|rhum)/iu;

// --- Quantités ---

const WORD_NUMBERS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11,
  douze: 12, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, cent: 100,
};
const UNICODE_FRACTIONS: Record<string, string> = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };

const NUMBER = String.raw`(?:\d+\s*/\s*\d+|\d+(?:[.,]\d+)?(?:\s+\d+\s*/\s*\d+)?)`;
const WORD = `(?:${Object.keys(WORD_NUMBERS).join('|')})`;
const QUANTITY_RE = new RegExp(
  String.raw`^(?:(?:environ|env\.|~|≈)\s*)?(${NUMBER}|${WORD}(?=[\s-]))(?:\s*(?:à|-|–|ou)\s*(${NUMBER}|${WORD}(?=\s)))?\s*`,
  'iu',
);
const HALF_RE = /^(?:(?:un|une)\s+)?demie?(?:[-\s]+)/iu;

function numberOf(token: string): number {
  const word = WORD_NUMBERS[token.toLowerCase()];
  if (word !== undefined) return word;
  const [whole, fraction] = token.includes('/') ? splitMixed(token) : [token, null];
  const base = whole ? Number(whole.replace(',', '.')) : 0;
  if (!fraction) return base;
  const [n, d] = fraction.split('/').map((s) => Number(s.trim()));
  return base + (d ? n / d : 0);
}

/** « 1 1/2 » → ['1', '1/2'] ; « 3/4 » → ['', '3/4']. */
function splitMixed(token: string): [string, string] {
  const match = /^(?:(\d+)\s+)?(\d+\s*\/\s*\d+)$/u.exec(token.trim());
  return match ? [match[1] ?? '', match[2]] : [token, ''];
}

// --- Nom et précisions ---

const LEADING_ADJECTIVES = /^(gros|grosse|grosses|petit|petite|petits|petites|moyen|moyenne|moyens|moyennes|beau|beaux|belle|belles|bon|bonne|bons|bonnes|grand|grande|grands|grandes)$/iu;
/** Mots qui ouvrent les précisions en fin de nom (« émincés », « en dés », « bien mûres »). */
const DESCRIPTOR =
  /^(emince|hache|rape|cisele|pele|epluche|coupe|ecrase|fondu|ramolli|tiede|mur|entier|entiere|epepine|egoutte|concasse|presse|lave|battu|cuit|denoyaute|tranche|effile|detaille|nettoye|degerme|equeute|decortique|bien|tres|finement|grossierement|legerement|facultatif|optionnel|a temperature|pour|selon|a volonte|au gout|environ)(e|s|es)?$/u;
const CUTS = /^(des|rondelles|morceaux|lamelles|cubes|tranches|julienne|quartiers|brunoise|batonnets|copeaux|petits|fines|des?)$/u;
/** Groupes qui gardent leur adjectif : « petits pois », « gros sel ». */
const FIXED = /^(petits?\s+pois|gros\s+sel|petits?-suisses?|petit\s+[eé]peautre|grand\s+marnier)\b/iu;
const SINGULAR_EXCEPTIONS = new Set(['pois', 'noix', 'riz', 'radis', 'ananas', 'anis', 'mais', 'maïs', 'jus', 'cassis', 'gras', 'gros', 'frais', 'epais', 'épais', 'fois', 'os', 'bois', 'brebis', 'paris', 'lys', 'tapas', 'couscous', 'pancetta', 'gruyeres']);
const PREPOSITIONS = new Set(['de', 'du', 'des', "d'", 'à', 'a', 'au', 'aux', 'en', 'pour', 'sans', 'avec']);

/** Sans accents ni majuscules, œ → oe : pour comparer. */
export function fold(text: string): string {
  return text.toLowerCase().replace(/œ/gu, 'oe').replace(/æ/gu, 'ae').normalize('NFD').replace(/\p{M}/gu, '');
}

function singularWord(word: string): string {
  const lower = word.toLowerCase();
  if (word.length <= 3 || SINGULAR_EXCEPTIONS.has(lower) || SINGULAR_EXCEPTIONS.has(fold(lower))) return word;
  if (/eaux$/iu.test(word)) return word.slice(0, -1);
  if (/(ou|eu|au)x$/iu.test(word)) return word.slice(0, -1);
  if (/[^s]s$/iu.test(word)) return word.slice(0, -1);
  return word;
}

/** Nom au singulier : chaque mot avant la première préposition (« pommes de terre » → « pomme de terre »). */
export function singular(name: string): string {
  const words = name.split(/\s+/u);
  const stop = words.findIndex((w) => PREPOSITIONS.has(w.toLowerCase()) || /^d['’]/iu.test(w));
  return words.map((w, i) => (stop === -1 || i < stop ? w.split('-').map(singularWord).join('-') : w)).join(' ');
}

/** Pluriel d'un nom commun (affichage d'une quantité qui passe au-dessus de 1). */
export function plural(word: string): string {
  if (/[sxz]$/iu.test(word)) return word;
  if (/(eau|eu|au)$/iu.test(word) || /^(chou|genou|caillou|hibou|bijou|joujou|pou)$/iu.test(word)) return `${word}x`;
  return `${word}s`;
}

/** Clé normalisée d'un ingrédient, pour le reconnaître d'une recette à l'autre (« Oignons » → « oignon »). */
export function ingredientKey(name: string): string {
  return fold(singular(name))
    .replace(/['’]/gu, ' ')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

const clean = (text: string) => text.replace(/\s+/gu, ' ').replace(/^[\s,;:.-]+|[\s,;:-]+$/gu, '').trim();
const lowerFirst = (text: string) => (/^\p{Lu}\p{Ll}/u.test(text) ? text[0].toLowerCase() + text.slice(1) : text);

/** Sépare le nom de ses précisions : parenthèses, après une virgule, adjectifs de tête, participes de fin. */
function splitName(label: string): { name: string; notes: string[]; optional: boolean } {
  const notes: string[] = [];
  let optional = false;
  let rest = label.replace(/\(([^)]*)\)/gu, (_, inner: string) => {
    if (/^\s*(facultatif|optionnel)\s*$/iu.test(inner)) optional = true;
    else if (inner.trim()) notes.push(inner.trim());
    return ' ';
  });
  const comma = rest.indexOf(',');
  if (comma !== -1) {
    notes.push(...rest.slice(comma + 1).split(',').map(clean).filter(Boolean));
    rest = rest.slice(0, comma);
  }
  let words = clean(rest).split(' ').filter(Boolean);
  if (!FIXED.test(words.join(' '))) {
    const lead: string[] = [];
    while (words.length > 1 && LEADING_ADJECTIVES.test(words[0])) lead.push(words.shift()!);
    notes.unshift(...lead);
  }
  const cut = words.findIndex((w, i) => i > 0 && (DESCRIPTOR.test(fold(w)) || (fold(w) === 'en' && CUTS.test(fold(words[i + 1] ?? '')))));
  if (cut !== -1) {
    notes.push(words.slice(cut).join(' '));
    words = words.slice(0, cut);
  }
  const filtered = notes.filter((n) => {
    if (/^(facultatif|optionnel)$/iu.test(n)) {
      optional = true;
      return false;
    }
    return true;
  });
  return { name: words.join(' '), notes: filtered, optional };
}

/**
 * Analyse une ligne d'ingrédient. Les lignes sans quantité gardent quantité et unité à null (« sel », « poivre du
 * moulin ») ; « quelques » passe dans les précisions. Rien n'est inventé : en cas de doute, le nom reste la ligne.
 */
export function parseIngredient(line: string): ParsedIngredient {
  let text = clean(
    line
      .replace(/[½¼¾⅓⅔⅛]/gu, (f) => ` ${UNICODE_FRACTIONS[f]}`)
      .replace(/(\d)\s+(\d+\/\d+)/gu, '$1 $2')
      .replace(/ | /gu, ' '),
  );
  let optional = false;
  const prefix = /^(facultatif|optionnel)\s*:?\s*/iu.exec(text);
  if (prefix) {
    optional = true;
    text = text.slice(prefix[0].length);
  }
  const notes: string[] = [];
  let quantity: number | null = null;
  let quantityMax: number | null = null;
  const vague = /^(un peu|quelques|un soupçon|une pointe)\s+(?:(?:de|d['’])\s*)?/iu.exec(text);
  const half = vague ? null : HALF_RE.exec(text);
  const match = vague || half ? null : QUANTITY_RE.exec(text);
  if (vague) {
    notes.push(vague[1].toLowerCase());
    text = text.slice(vague[0].length);
  } else if (half) {
    quantity = 0.5;
    text = text.slice(half[0].length);
  } else if (match) {
    quantity = numberOf(match[1].trim());
    quantityMax = match[2] ? numberOf(match[2].trim()) : null;
    if (/^(environ|env\.|~|≈)/iu.test(match[0])) notes.push('environ');
    text = text.slice(match[0].length);
  }

  let unit: Unit | null = null;
  if (quantity !== null) {
    for (const [candidate, re] of UNIT_RES) {
      const found = re.exec(text);
      if (!found) continue;
      const after = text.slice(found[0].length).replace(/^(?:de\s+|d['’]\s*)/iu, '');
      if (!clean(after)) break; // « 10 noix » : le mot est l'ingrédient, pas l'unité
      if (candidate === 'filet' && !LIQUID.test(after)) break;
      unit = candidate;
      text = after;
      break;
    }
    unit ??= 'piece';
  } else {
    // « Une pincée de sel » sans chiffre : déjà pris par les nombres en lettres ; ici, « pincée de sel ».
    for (const [candidate, re] of UNIT_RES) {
      if (candidate !== 'pincee' && candidate !== 'filet') continue;
      const found = re.exec(text);
      if (!found) continue;
      const after = text.slice(found[0].length).replace(/^(?:de\s+|d['’]\s*)/iu, '');
      if (candidate === 'filet' && !LIQUID.test(after)) continue;
      quantity = 1;
      unit = candidate;
      text = after;
      break;
    }
  }

  const label = clean(text);
  const split = splitName(label);
  const name = singular(lowerFirst(clean(split.name) || label));
  return {
    quantity,
    quantityMax: quantityMax !== null && quantity !== null && quantityMax > quantity ? quantityMax : null,
    unit,
    label,
    name,
    notes: [...notes, ...split.notes].join(', '),
    optional: optional || split.optional,
  };
}

/**
 * Une ligne peut porter plusieurs ingrédients sans quantité (« Sel, poivre », « sel et poivre ») : ils sont séparés,
 * chacun gardant la ligne d'origine. Une ligne avec quantité n'est jamais coupée.
 */
export function parseIngredientLine(line: string): ParsedIngredient[] {
  const parsed = parseIngredient(line);
  if (parsed.quantity !== null) return [parsed];
  const parts = clean(line).split(/\s*,\s*|\s+et\s+/u).filter(Boolean);
  if (parts.length < 2 || parts.some((p) => p.split(' ').length > 3 || /\d/u.test(p))) return [parsed];
  return parts.map((part) => parseIngredient(part));
}

// --- Affichage et mise à l'échelle ---

const UNIT_LABELS: Record<Unit, [string, string]> = {
  g: ['g', 'g'], kg: ['kg', 'kg'], mg: ['mg', 'mg'], ml: ['ml', 'ml'], cl: ['cl', 'cl'], dl: ['dl', 'dl'], l: ['l', 'l'],
  cs: ['c. à s.', 'c. à s.'], cc: ['c. à c.', 'c. à c.'], pincee: ['pincée', 'pincées'], gousse: ['gousse', 'gousses'],
  tranche: ['tranche', 'tranches'], sachet: ['sachet', 'sachets'], boite: ['boîte', 'boîtes'], brin: ['brin', 'brins'],
  branche: ['branche', 'branches'], feuille: ['feuille', 'feuilles'], botte: ['botte', 'bottes'],
  bouquet: ['bouquet', 'bouquets'], verre: ['verre', 'verres'], tasse: ['tasse', 'tasses'], bol: ['bol', 'bols'],
  noix: ['noix', 'noix'], poignee: ['poignée', 'poignées'], filet: ['filet', 'filets'], morceau: ['morceau', 'morceaux'],
  pot: ['pot', 'pots'], cube: ['cube', 'cubes'], paquet: ['paquet', 'paquets'], rouleau: ['rouleau', 'rouleaux'],
  tablette: ['tablette', 'tablettes'], barquette: ['barquette', 'barquettes'], louche: ['louche', 'louches'],
  piece: ['', ''],
};
const METRIC = new Set<Unit>(['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l']);

/** Nom d'une unité pour une quantité (« pincée », « pincées ») ; vide pour une pièce. */
export const unitLabel = (unit: Unit, quantity = 1) => UNIT_LABELS[unit][quantity > 1 ? 1 : 0];

const FRACTIONS: [number, string][] = [[0, ''], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾'], [1, '']];
const decimal = (n: number, digits: number) => String(Number(n.toFixed(digits))).replace('.', ',');

/**
 * Quantité lisible : grammes et millilitres arrondis à ce qui se pèse (5 g près au-delà de 100), litres et kilos à
 * deux décimales, le reste au quart ou au tiers près (« 1 ½ »). Jamais zéro pour une quantité positive.
 */
export function formatQuantity(quantity: number, unit: Unit | null): string {
  if (unit && METRIC.has(unit)) {
    if (unit === 'g' || unit === 'ml' || unit === 'mg') {
      if (quantity >= 100) return String(Math.round(quantity / 5) * 5);
      if (quantity >= 10) return String(Math.round(quantity));
      return decimal(Math.max(quantity, 0.1), 1);
    }
    return decimal(quantity, quantity >= 10 ? 0 : 2);
  }
  const whole = Math.floor(quantity);
  const rest = quantity - whole;
  const [frac, sign] = FRACTIONS.reduce((best, f) => (Math.abs(f[0] - rest) < Math.abs(best[0] - rest) ? f : best));
  const total = whole + frac;
  if (total === 0) return '¼';
  if (frac === 1) return String(whole + 1);
  if (!sign) return String(whole);
  return whole ? `${whole} ${sign}` : sign;
}

export type QuantityFields = Pick<ParsedIngredient, 'quantity' | 'quantityMax' | 'unit' | 'label'>;

const startsWithVowel = (text: string) => /^[aeiouyhâàéèêëîïôûœ]/iu.test(text);

/**
 * Ligne réécrite pour un facteur d'échelle (2 → deux fois plus) : « 600 g de farine », « 2 c. à s. d'huile »,
 * « 4 gros oignons émincés ». Sans quantité, le libellé tel quel.
 */
export function formatIngredient(line: QuantityFields, factor = 1): string {
  if (line.quantity === null || line.unit === null) return line.label;
  const low = line.quantity * factor;
  const high = line.quantityMax !== null ? line.quantityMax * factor : null;
  const amount = high !== null ? `${formatQuantity(low, line.unit)} à ${formatQuantity(high, line.unit)}` : formatQuantity(low, line.unit);
  const many = (high ?? low) > 1;
  if (line.unit === 'piece') {
    const [first, ...rest] = line.label.split(' ');
    const wasMany = (line.quantityMax ?? line.quantity) > 1;
    if (!first || LEADING_ADJECTIVES.test(first) || many === wasMany) return `${amount} ${line.label}`.trim();
    return `${amount} ${[many ? plural(first) : singularWord(first), ...rest].join(' ')}`;
  }
  const name = unitLabel(line.unit, high ?? low);
  if (!line.label) return `${amount} ${name}`;
  return `${amount} ${name} ${startsWithVowel(line.label) ? "d'" : 'de '}${line.label}`;
}

// --- Rayons : une première idée pour ranger la liste de courses (version suivante) ---

const AISLES: [string, RegExp][] = [
  ['Fruits et légumes', /^(oignon|echalote|ail|carotte|poireau|pomme-de-terre|tomate|courgette|aubergine|poivron|salade|laitue|epinard|chou|brocoli|champignon|citron|orange|pomme|poire|banane|fraise|framboise|myrtille|avocat|concombre|radis|navet|celeri|fenouil|potiron|courge|butternut|patate|haricot-vert|petit-pois|persil|ciboulette|coriandre|basilic|menthe|thym|laurier|romarin|estragon|gingembre|citron-vert|mangue|ananas|kiwi|raisin|abricot|peche|cerise|prune|betterave|asperge|endive|artichaut|mache|roquette|cresson|figue|melon|pasteque|rhubarbe|chataigne)/u],
  ['Boucherie', /^(poulet|boeuf|veau|porc|agneau|dinde|canard|lapin|steak|viande|escalope|cuisse|blanc-de-poulet|filet-de-poulet|jambon|lardon|bacon|saucisse|chorizo|merguez|boulette|roti|cote|magret|foie|rillette|pancetta|chair-a-saucisse|haché)/u],
  ['Poissonnerie', /^(saumon|cabillaud|thon|crevette|moule|colin|merlu|lieu|dorade|bar|truite|sardine|maquereau|calamar|seiche|noix-de-saint-jacques|saint-jacques|poisson|crabe|homard|surimi|anchois)/u],
  ['Crèmerie', /^(lait|beurre|creme|oeuf|fromage|yaourt|emmental|gruyere|parmesan|mozzarella|comte|chevre|feta|ricotta|mascarpone|roquefort|camembert|brie|reblochon|raclette|petit-suisse|faisselle|fromage-blanc)/u],
  ['Boulangerie', /^(pain|baguette|brioche|pain-de-mie|biscotte|chapelure)/u],
  ['Épices et condiments', /^(sel|poivre|curry|cumin|paprika|cannelle|muscade|curcuma|piment|herbe-de-provence|moutarde|vinaigre|ketchup|mayonnaise|sauce-soja|cornichon|capre|olive|bouquet-garni|clou-de-girofle|vanille|safran|origan|gingembre-en-poudre|quatre-epice|ras-el-hanout|tabasco|harissa)/u],
  ['Épicerie', /^(farine|sucre|riz|pate|spaghetti|tagliatelle|coquillette|penne|lasagne|semoule|couscous|quinoa|lentille|pois-chiche|haricot|huile|bouillon|fond-de|levure|maizena|fecule|chocolat|cacao|miel|confiture|amande|noisette|noix|pignon|raisin-sec|lait-de-coco|concentre-de-tomate|coulis|sauce-tomate|tomate-pelee|pulpe-de-tomate|cafe|the|biscuit|pate-feuilletee|pate-brisee|pate-sablee|pate-a-pizza|vin|cidre|biere|eau|sirop|cornflake|flocon)/u],
  ['Surgelés', /^(glace|surgele)/u],
];

/** Rayon probable d'un ingrédient d'après sa clé, ou null s'il n'est pas connu. */
export function guessAisle(key: string): string | null {
  // Les plus précis d'abord : « lait de coco » est à l'épicerie, pas à la crèmerie.
  const special = SPECIAL_AISLES.find(([prefix]) => key.startsWith(prefix));
  if (special) return special[1];
  return AISLES.find(([, re]) => re.test(key))?.[0] ?? null;
}

const SPECIAL_AISLES: [string, string][] = [
  ['lait-de-coco', 'Épicerie'],
  ['creme-de-coco', 'Épicerie'],
  ['concentre-de-tomate', 'Épicerie'],
  ['pulpe-de-tomate', 'Épicerie'],
  ['tomate-pelee', 'Épicerie'],
  ['tomate-concassee', 'Épicerie'],
  ['sauce-tomate', 'Épicerie'],
  ['bouillon', 'Épicerie'],
  ['noix-de-saint-jacques', 'Poissonnerie'],
  ['noix-de-muscade', 'Épices et condiments'],
  ['haricot-vert', 'Fruits et légumes'],
  ['gros-sel', 'Épices et condiments'],
  ['petit-pois', 'Fruits et légumes'],
];
