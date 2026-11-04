import { describe, expect, it } from 'vitest';
import { routineFooter, routineTitle } from './routine.ts';
import { dialMinutes, endsAtText, formatCountdown, formatDuration, secondsLeft, timerLook, timerName, timerProgress } from './timers.ts';

const items = (...done: boolean[]) => done.map((d, i) => ({ id: `evening-${i}`, label: `Étape ${i}`, done: d }));

describe('routines', () => {
  it('titre avec avancement, encouragement à la fin et en série', () => {
    expect(routineTitle({ period: 'evening', items: items(true, false, false) })).toBe('Routine du soir · 1/3');
    expect(routineTitle({ period: 'morning', items: items() })).toBe('Routine du matin · 0/0');
    expect(routineFooter({ items: items(true, false), streak: 0 })).toBeNull();
    expect(routineFooter({ items: items(true, false), streak: 3 })).toBe('3 jours de suite : continue !');
    expect(routineFooter({ items: items(true, true), streak: 1 })).toBe("Bravo, c'est fini !");
    expect(routineFooter({ items: items(true, true), streak: 4 })).toBe("Bravo, c'est fini ! 4 jours de suite");
  });
});

describe('minuteurs', () => {
  const now = new Date(2026, 10, 4, 18, 0, 0);
  it('temps restant, arrondi à la seconde supérieure, jamais négatif', () => {
    expect(secondsLeft({ endsAt: new Date(now.getTime() + 61_500).toISOString() }, now)).toBe(62);
    expect(secondsLeft({ endsAt: new Date(now.getTime() - 5_000).toISOString() }, now)).toBe(0);
  });

  it('affichage', () => {
    expect(formatCountdown(62)).toBe('1:02');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(3723)).toBe('1:02:03');
    expect(formatDuration(5)).toBe('5 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(90)).toBe('1 h 30');
    expect(timerName({ label: '' })).toBe('Minuteur');
    expect(timerName({ label: 'Cuisson' })).toBe('Cuisson');
    expect(timerLook('Cuisson')).toEqual({ emoji: '🍝', color: '#f2b84b' });
    expect(timerLook('').emoji).toBe('⏱️');
    expect(endsAtText(now, 75)).toBe('fin à 19 h 15');
  });

  it('roue du temps : angle en minutes, butées en haut', () => {
    const at = (minutes: number) => (minutes / 60) * 2 * Math.PI;
    expect(dialMinutes(at(15), 10)).toBe(15);
    expect(dialMinutes(at(44.6), 40)).toBe(45);
    expect(dialMinutes(at(2), 58)).toBe(60); // on dépasse le haut en montant : butée à 60
    expect(dialMinutes(at(57), 3)).toBe(0); // en descendant : butée à 0
    expect(dialMinutes(at(59.8), 50)).toBe(60);
    expect(dialMinutes(-at(5), 30)).toBe(55);
  });

  it('part du temps restant', () => {
    const timer = { durationSeconds: 600, endsAt: new Date(now.getTime() + 150_000).toISOString() };
    expect(timerProgress(timer, now)).toBe(0.25);
    expect(timerProgress({ ...timer, endsAt: now.toISOString() }, now)).toBe(0);
  });
});
