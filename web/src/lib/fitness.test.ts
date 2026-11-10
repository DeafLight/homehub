// Tests de l'affichage du programme de renforcement : durées, exercices d'une famille, tour de taille, semaine.
import { describe, expect, it } from 'vitest';
import { exerciseById } from '../../../shared/fitness-catalogue.ts';
import { emptyFitness } from '../../../shared/fitness.ts';
import { familyExercises, formatMinutes, placementOf, waistPath, waistSeries, weekLogChanged, weekLogInput } from './fitness.ts';

describe('onglet Sport', () => {
  it('durées lisibles', () => {
    expect(formatMinutes(1200)).toBe('20 min');
    expect(formatMinutes(1350)).toBe('22 min 30');
  });

  it('exercices d’une famille, sans doublon', () => {
    const list = familyExercises('jambes');
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list.map((e) => e.id)).size).toBe(list.length);
    expect(list.every((e) => e.family === 'jambes')).toBe(true);
  });

  it('le catalogue montre aussi les rowings à l’élastique et les versions sans saut', () => {
    expect(familyExercises('dos').map((e) => e.id)).toEqual(expect.arrayContaining(['rowing-elastique', 'rowing-elastique-un-bras']));
    expect(familyExercises('jambes').map((e) => e.id)).toContain('squats-lents');
  });

  it('place d’un exercice : élastique, sans sauts, versions voisines', () => {
    const row = placementOf(exerciseById('rowing-elastique-pause')!);
    expect(row).toMatchObject({ places: [], band: 2, easier: { id: 'rowing-elastique' }, harder: { id: 'rowing-elastique-un-bras' } });
    expect(placementOf(exerciseById('burpees')!).withoutJumps?.id).toBe('mountain-climbers');
    expect(placementOf(exerciseById('jacks-sans-saut')!).replaces.map((e) => e.id)).toEqual(['jumping-jacks', 'genoux-hauts']);
    expect(placementOf(exerciseById('squats')!)).toMatchObject({ band: null, replaces: [], withoutJumps: null });
  });

  it('tours de taille dans l’ordre des semaines, courbe dans son cadre', () => {
    const state = { ...emptyFitness(), weeks: { '2026-W45': { cardio: null, waist: 90 }, '2026-W43': { cardio: 30, waist: 92 }, '2026-W44': { cardio: 10, waist: null } } };
    const series = waistSeries(state);
    expect(series).toEqual([
      { week: '2026-W43', waist: 92 },
      { week: '2026-W45', waist: 90 },
    ]);
    expect(waistPath(series)).toBe('6,8 294,72');
    expect(waistPath([{ waist: 90 }, { waist: 90 }])).toBe('6,72 294,72');
  });

  it('semaine : champs vides à null, cardio arrondi, changement détecté', () => {
    expect(weekLogInput(42.6, 88.5)).toEqual({ cardio: 43, waist: 88.5 });
    expect(weekLogInput('', null)).toEqual({ cardio: null, waist: null });
    expect(weekLogChanged(undefined, null, null)).toBe(false);
    expect(weekLogChanged({ cardio: 30, waist: null }, 30, null)).toBe(false);
    expect(weekLogChanged({ cardio: 30, waist: null }, 40, null)).toBe(true);
    expect(weekLogChanged(undefined, null, 90)).toBe(true);
  });
});
