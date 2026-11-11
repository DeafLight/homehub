// Tests de la recherche d'académie et du libellé du choix (page « Vacances scolaires »).
import { describe, expect, it } from 'vitest';
import { choiceLabel, comparable, groupAcademies, OVERSEAS_GROUP, sameChoice } from './holiday-settings.ts';

const ACADEMIES = [
  { name: 'Nantes', zone: 'Zone B' },
  { name: 'Aix-Marseille', zone: 'Zone B' },
  { name: 'Orléans-Tours', zone: 'Zone B' },
  { name: 'Créteil', zone: 'Zone C' },
  { name: 'Besançon', zone: 'Zone A' },
  { name: 'Réunion', zone: 'Réunion' },
  { name: 'Corse', zone: 'Corse' },
];
const titles = (query: string) => groupAcademies(ACADEMIES, query).map((g) => [g.title, g.academies.map((a) => a.name)]);

describe('recherche d’académie', () => {
  it('saisie vide : toutes, par zone puis Corse et outre-mer, triées par nom', () => {
    expect(titles('')).toEqual([
      ['Zone A', ['Besançon']],
      ['Zone B', ['Aix-Marseille', 'Nantes', 'Orléans-Tours']],
      ['Zone C', ['Créteil']],
      [OVERSEAS_GROUP, ['Corse', 'Réunion']],
    ]);
  });

  it('sans accents ni majuscules, tirets comme espaces, n’importe où dans le nom', () => {
    expect(titles('CRETEIL')).toEqual([['Zone C', ['Créteil']]]);
    expect(titles('orleans tours')).toEqual([['Zone B', ['Orléans-Tours']]]);
    expect(titles('mars')).toEqual([['Zone B', ['Aix-Marseille']]]);
    expect(titles(' reu')).toEqual([[OVERSEAS_GROUP, ['Réunion']]]);
    expect(titles('atlantide')).toEqual([]);
    expect(comparable('  Saint Pierre-et-Miquelon ')).toBe('saint pierre et miquelon');
  });
});

describe('libellé du choix', () => {
  it('académie avec sa zone, zone seule, territoire, aucune', () => {
    expect(choiceLabel({ academie: 'Nantes' }, ACADEMIES)).toBe('Académie de Nantes (zone B)');
    expect(choiceLabel({ academie: 'Aix-Marseille' }, ACADEMIES)).toBe('Académie d’Aix-Marseille (zone B)');
    expect(choiceLabel({ academie: 'Réunion' }, ACADEMIES)).toBe('Réunion');
    expect(choiceLabel({ zone: 'C' }, ACADEMIES)).toBe('Zone C');
    expect(choiceLabel(null, ACADEMIES)).toMatch(/^Aucune/);
  });

  it('comparaison de deux choix', () => {
    expect(sameChoice({ zone: 'A' }, { zone: 'A' })).toBe(true);
    expect(sameChoice({ zone: 'A' }, { academie: 'Nantes' })).toBe(false);
    expect(sameChoice(null, null)).toBe(true);
  });
});
