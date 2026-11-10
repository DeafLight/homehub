// Tests des dates locales en texte.
import { describe, expect, it } from 'vitest';
import { localDay, localTime } from './dates.ts';

describe('dates locales', () => {
  it('jour AAAA-MM-JJ et heure HH:MM, avec les zéros', () => {
    const date = new Date(2026, 0, 5, 7, 3);
    expect(localDay(date)).toBe('2026-01-05');
    expect(localTime(date)).toBe('07:03');
  });
});
