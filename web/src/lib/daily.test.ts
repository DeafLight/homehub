import { describe, expect, it } from 'vitest';
import { routineFooter, routineTitle } from './routine.ts';
import { dialPosition, dialTap, dialTurn, endsAtText, formatCountdown, formatDuration, secondsLeft, timerLook, timerName, timerProgress } from './timers.ts';

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
    expect(endsAtText(now, 8 * 60 + 10)).toBe('fin demain à 2 h 10');
  });

  it('roue du temps : plusieurs tours, jamais sous 0', () => {
    expect(dialPosition((15 / 60) * 2 * Math.PI)).toBeCloseTo(15);
    expect(dialPosition(-(5 / 60) * 2 * Math.PI)).toBeCloseTo(55);
    expect(dialTurn(10, 10, 25)).toBe(25);
    expect(dialTurn(58, 58, 3)).toBe(63); // passer le haut en montant : un tour de plus
    expect(dialTurn(63, 3, 57)).toBe(57); // et en redescendant
    expect(dialTurn(2, 2, 50)).toBe(0); // pas sous 0
    expect(dialTurn(24 * 60 - 1, 59, 5)).toBe(24 * 60); // 24 h au plus
    expect(dialTap(10, 40)).toBe(40);
    expect(dialTap(70, 5)).toBe(65); // toucher dans le tour en cours
    expect(dialTap(118, 2)).toBe(122); // ou le suivant, s'il est plus près
  });

  it('part du temps restant', () => {
    const timer = { durationSeconds: 600, endsAt: new Date(now.getTime() + 150_000).toISOString() };
    expect(timerProgress(timer, now)).toBe(0.25);
    expect(timerProgress({ ...timer, endsAt: now.toISOString() }, now)).toBe(0);
  });
});
