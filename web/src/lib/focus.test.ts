import { describe, expect, it } from 'vitest';
import type { DashboardData, Homework, Routine } from '../../../shared/types.ts';
import { dayPlan } from './day.ts';
import { focusCard, focusTiles, timelineDay } from './focus.ts';

// Lundi 2 novembre 2026.
const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m);
const hw = (id: string, due: string, done = false): Homework => ({ id, subject: id, due, text: '', done });
const routine = (period: Routine['period'], done = 0): Routine => ({
  period,
  items: [0, 1, 2].map((i) => ({ id: `${period}-${i}`, label: `Étape ${i}`, done: i < done })),
  streak: 0,
});
const base = (over: Partial<DashboardData> = {}) => ({
  routine: null,
  homework: null,
  tasks: [{ id: 't', label: 'Ranger', done: false }],
  notes: [],
  events: [],
  ...over,
});
const name = (id: string | null) => (id === 'alex' ? 'Papa' : undefined);

describe('carte du moment', () => {
  it('routine du matin, puis devoirs après l’école, puis routine du soir', () => {
    const homework = [hw('maths', '2026-11-03')];
    expect(focusCard(base({ routine: routine('morning'), homework }), at(7, 30))).toBe('routine');
    expect(focusCard(base({ homework }), at(16, 30))).toBe('homework');
    expect(focusCard(base({ routine: routine('evening'), homework }), at(17, 30))).toBe('homework');
    expect(focusCard(base({ routine: routine('evening'), homework }), at(19, 30))).toBe('routine');
    expect(focusCard(base({ routine: routine('evening'), homework: [hw('maths', '2026-11-03', true)] }), at(17, 30))).toBe('routine');
    expect(focusCard(base(), at(15))).toBe('upcoming');
  });
});

describe('frise', () => {
  const course = (h1: number, h2: number) => ({ id: `${h1}`, subject: 'Maths', start: at(h1).toISOString(), end: at(h2).toISOString(), cancelled: false });
  it('passe à demain une fois la journée finie, ou l’après-midi sans cours', () => {
    const plan = dayPlan([course(8, 10), course(14, 16)], [], at(0));
    expect(timelineDay(plan, at(15))).toBe('today');
    expect(timelineDay(plan, at(16, 1))).toBe('tomorrow');
    expect(timelineDay(dayPlan([], [], at(0)), at(9))).toBe('today');
    expect(timelineDay(dayPlan([], [], at(0)), at(13))).toBe('tomorrow');
  });
});

describe('tuiles', () => {
  it('tout sauf la carte du moment, avec ce qui est nouveau mis en avant', () => {
    const data = base({
      routine: routine('morning', 1),
      homework: [hw('maths', '2026-11-03'), hw('fr', '2026-11-03'), hw('svt', '2026-11-05')],
      notes: [{ id: 'n', text: 'Bravo', to: 'lea', from: { ownerId: 'alex', via: 'phone' }, at: at(7).toISOString() }],
      events: [{ id: 'e', title: 'Piscine', start: at(17, 45).toISOString() }],
    });
    expect(focusTiles(data, at(7, 30), name)).toEqual([
      { kind: 'homework', value: '2', label: 'devoirs pour demain', highlight: true },
      { kind: 'tasks', value: '1', label: 'tâche', highlight: false },
      { kind: 'notes', value: '1', label: 'mot de Papa', highlight: true },
      { kind: 'upcoming', value: 'Piscine', label: 'aujourd’hui à 17:45', highlight: false },
    ]);
    const evening = focusTiles({ ...data, routine: routine('evening', 1), notes: [], tasks: [] }, at(17, 0), name);
    expect(evening.map((t) => [t.kind, t.value, t.label])).toEqual([
      ['routine', '1/3', 'routine du soir'],
      ['tasks', '✓', 'rien à faire'],
      ['notes', '+', 'laisser un mot'],
      ['upcoming', 'Piscine', 'aujourd’hui à 17:45'],
    ]);
  });
});
