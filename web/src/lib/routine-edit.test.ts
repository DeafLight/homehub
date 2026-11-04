import { describe, expect, it } from 'vitest';
import type { RoutineSettings, RoutineWindows } from '../../../shared/types.ts';
import { draftProblem, moveStep, newStepId, stepsOnDay, toggleDay, toInput } from './routine-edit.ts';

const step = (label: string, days: number[] | null = null) => ({ id: label, label, days });
const windows: RoutineWindows = { morning: { from: '06:30', to: '08:30' }, evening: { from: '19:00', to: '21:00' } };

describe('page Routines', () => {
  it('jours : éteindre, rallumer ; le dernier reste ; tous allumés : tous les jours', () => {
    const wednesdayOff = toggleDay(step('Dents'), 3);
    expect(wednesdayOff.days).toEqual([0, 1, 2, 4, 5, 6]);
    expect(toggleDay(wednesdayOff, 3).days).toBeNull();
    const onlyMonday = step('Sport', [1]);
    expect(toggleDay(onlyMonday, 1)).toBe(onlyMonday);
    expect(toggleDay(onlyMonday, 5).days).toEqual([1, 5]);
  });

  it('ordre des étapes', () => {
    expect(moveStep(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveStep(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveStep(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });

  it('identifiant nouveau', () => {
    const values = [0.5, 0.25];
    const random = () => values.shift() ?? 0.75;
    const taken = newStepId([], () => 0.5);
    expect(newStepId([{ id: taken }], random)).not.toBe(taken);
  });

  it("étapes prévues aujourd'hui", () => {
    const plan = { morning: [step('Dents'), step('Piscine', [3])], evening: [step('Devoirs', [1, 2, 4])] };
    expect(stepsOnDay(plan, new Date(2026, 10, 4))).toEqual({ morning: 2, evening: 0 }); // mercredi
  });

  it('problèmes avant enregistrement', () => {
    const settings = (morning: ReturnType<typeof step>[], w = windows): RoutineSettings => ({
      source: 'tablet',
      windows: w,
      members: { lea: { morning, evening: [] } },
    });
    const nameOf = () => 'Léa';
    expect(draftProblem(settings([step('Dents'), step('Pyjama')]), nameOf)).toBeNull();
    expect(draftProblem(settings([step('Dents'), step(' dents ')]), nameOf)).toBe('Léa : « Dents » est en double');
    expect(draftProblem(settings([step('  ')]), nameOf)).toBe("Léa : une étape n'a pas de nom");
    expect(draftProblem(settings([], { ...windows, weekend: { evening: { from: '22:00', to: '21:00' } } }), nameOf)).toBe(
      'Heures du soir du week-end : le début doit précéder la fin',
    );
    expect(toInput(settings([step(' Dents ')]))).toEqual({ windows, members: { lea: { morning: [{ id: ' Dents ', label: 'Dents', days: null }], evening: [] } } });
  });
});
