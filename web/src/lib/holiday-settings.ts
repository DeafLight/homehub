// Page « Vacances scolaires » : logique testable de la recherche d'académie (saisie sans accents ni majuscules,
// résultats regroupés par zone, Corse et outre-mer à part), du mode affiché et du libellé du choix.
import type { Academie, HolidayChoice } from '../../../shared/types.ts';

export const ZONES = ['A', 'B', 'C'] as const;
export type Zone = (typeof ZONES)[number];

/** Titre du groupe des académies qui ont leur propre calendrier. */
export const OVERSEAS_GROUP = 'Corse et outre-mer';

/** Texte comparable : sans accents, minuscules, tirets et espaces réduits (« orleans tours » = « Orléans-Tours »). */
export const comparable = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[-'’\s]+/g, ' ')
    .trim();

export type AcademieGroup = { title: string; academies: Academie[] };

/**
 * Académies dont le nom contient la saisie (n'importe où dans un mot : « mars » trouve Aix-Marseille), triées par nom
 * et regroupées : Zone A, Zone B, Zone C, puis Corse et outre-mer. Saisie vide : toutes. Groupes vides omis.
 */
export function groupAcademies(academies: readonly Academie[], query: string): AcademieGroup[] {
  const q = comparable(query);
  const groups = new Map<string, Academie[]>([...ZONES.map((z) => [`Zone ${z}`, []] as [string, Academie[]]), [OVERSEAS_GROUP, []]]);
  for (const academie of academies) {
    if (q && !comparable(academie.name).includes(q)) continue;
    const title = groups.has(academie.zone) ? academie.zone : OVERSEAS_GROUP;
    groups.get(title)?.push(academie);
  }
  return [...groups]
    .filter(([, list]) => list.length > 0)
    .map(([title, list]) => ({ title, academies: [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr')) }));
}

/** « Académie de Nantes (zone B) », « Zone C », « Corse », « Aucune : vacances non affichées ». */
export function choiceLabel(choice: HolidayChoice, academies: readonly Academie[]): string {
  if (!choice) return 'Aucune : vacances non affichées';
  if ('zone' in choice) return `Zone ${choice.zone}`;
  const zone = academies.find((a) => a.name === choice.academie)?.zone;
  if (!zone || zone === choice.academie) return choice.academie;
  return `Académie ${/^[AEIOUYÉ]/i.test(choice.academie) ? 'd’' : 'de '}${choice.academie} (${zone.replace('Zone', 'zone')})`;
}

/** Deux choix identiques (pour savoir s'il y a quelque chose à enregistrer). */
export const sameChoice = (a: HolidayChoice, b: HolidayChoice) => JSON.stringify(a) === JSON.stringify(b);

/** Mode de la page : par académie, par zone, ou aucune vacance affichée. */
export type HolidayMode = 'academie' | 'zone' | 'none';

/**
 * Mode qui correspond à un choix, et donc mode affiché à l'ouverture et après « Annuler » : sans choix (rien
 * enregistré et pas de section `holidays` dans la config), c'est « Aucune », puisque rien ne s'affiche.
 */
export const modeOf = (choice: HolidayChoice): HolidayMode => (!choice ? 'none' : 'zone' in choice ? 'zone' : 'academie');
