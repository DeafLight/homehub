// Groupes d'ingrédients et d'étapes dans notre version d'une recette (« Pour la pâte », « Cuisson »), sans DOM
// (testé) : créer, renommer, retirer, déplacer un groupe, y ranger ou en sortir une ligne. Un groupe n'est que le
// champ `section` des lignes : les identifiants ne changent jamais (menus, liste de courses et notes pointent sur la
// recette et ses lignes), et l'ordre des lignes est gardé. Règle tenue par chaque opération : les lignes d'un groupe
// se suivent, et les lignes sans groupe viennent en tête (affichées sans titre, elles sembleraient sinon appartenir
// au groupe d'avant).
import { RECIPE_LIMITS } from '../../../shared/recipes.ts';

type Item = { id: string; section: string | null };

/** Nom de groupe propre (espaces resserrés, longueur bornée), ou null s'il est vide. */
export function cleanGroupName(name: string): string | null {
  const clean = name.trim().replace(/\s+/gu, ' ').slice(0, RECIPE_LIMITS.section).trim();
  return clean || null;
}

/** Noms des groupes, dans l'ordre de la recette (sans les lignes hors groupe). */
export function groupNames(items: readonly Item[]): string[] {
  const names: string[] = [];
  for (const item of items) if (item.section !== null && !names.includes(item.section)) names.push(item.section);
  return names;
}

/** Index juste après la dernière ligne de `section` ; pour null, après les lignes sans groupe de tête. -1 : groupe absent. */
function endOf(items: readonly Item[], section: string | null): number {
  if (section === null) {
    const first = items.findIndex((x) => x.section !== null);
    return first < 0 ? items.length : first;
  }
  const last = items.reduce((at, x, i) => (x.section === section ? i : at), -1);
  return last < 0 ? -1 : last + 1;
}

/** Ajoute des lignes à la fin d'un groupe (sans groupe : à la fin de celles de tête ; groupe nouveau : à la fin). */
export function insertInGroup<T extends Item>(items: readonly T[], added: readonly T[], section: string | null): T[] {
  const placed = added.map((x) => ({ ...x, section }));
  const end = endOf(items, section);
  const at = end < 0 ? items.length : end;
  return [...items.slice(0, at), ...placed, ...items.slice(at)];
}

/** Range une ligne dans un groupe (ou l'en sort avec null) : elle va à la fin de ce groupe. */
export function moveToGroup<T extends Item>(items: readonly T[], id: string, section: string | null): T[] {
  const item = items.find((x) => x.id === id);
  if (!item || item.section === section) return [...items];
  return insertInGroup(
    items.filter((x) => x.id !== id),
    [item],
    section,
  );
}

/**
 * Monte (-1) ou descend (1) une ligne d'un cran. À la limite de son groupe, elle passe dans le groupe voisin sans
 * changer de place : la première ligne de « Cuisson » qui monte devient la dernière de « Pour la pâte ».
 */
export function moveInGroups<T extends Item>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const neighbor = items[target];
  if (items[index].section !== neighbor.section) return items.map((x, i) => (i === index ? { ...x, section: neighbor.section } : x));
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Retire un groupe sans retirer ses lignes : elles rejoignent le groupe d'avant (ou les lignes sans groupe en tête). */
export function removeGroup<T extends Item>(items: readonly T[], name: string): T[] {
  let before: string | null = null;
  return items.map((x) => {
    if (x.section === name) return { ...x, section: before };
    before = x.section;
    return x;
  });
}

/**
 * Renomme un groupe. Un nom vide retire le groupe ; le nom d'un autre groupe les réunit (les lignes renommées
 * rejoignent la fin de l'autre groupe, chacune dans son ordre).
 */
export function renameGroup<T extends Item>(items: readonly T[], from: string, to: string): T[] {
  const name = cleanGroupName(to);
  if (name === null) return removeGroup(items, from);
  if (name === from) return [...items];
  const moved = items.filter((x) => x.section === from).map((x) => ({ ...x, section: name }));
  if (!items.some((x) => x.section === name)) return items.map((x) => (x.section === from ? { ...x, section: name } : x));
  return insertInGroup(
    items.filter((x) => x.section !== from),
    moved,
    name,
  );
}

/** Déplace tout un groupe avant (-1) ou après (1) le groupe voisin ; les lignes sans groupe restent en tête. */
export function moveGroup<T extends Item>(items: readonly T[], name: string, delta: -1 | 1): T[] {
  const blocks: T[][] = [];
  for (const item of items) {
    const last = blocks.at(-1);
    if (last && last[0].section === item.section) last.push(item);
    else blocks.push([item]);
  }
  const index = blocks.findIndex((b) => b[0].section === name);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= blocks.length || blocks[target][0].section === null) return [...items];
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  return blocks.flat();
}
