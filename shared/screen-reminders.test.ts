// Tests des règles des rappels sur la télé : heure due et rattrapage, une fois par jour, textes (routine du soir, mots
// à lire), réglages complétés par les valeurs par défaut.
import { describe, expect, it } from 'vitest';
import { notesReminderText, reminderDue, routineReminderText, SCREEN_REMINDER_CATCH_UP_MIN, SCREEN_REMINDER_DEFAULTS, withDefaults } from './screen-reminders.ts';

const at = (h: number, m: number) => new Date(2026, 10, 2, h, m);

describe('reminderDue', () => {
  it('part à l’heure et pendant le rattrapage, pas avant ni après', () => {
    expect(reminderDue('19:30', at(19, 29), null)).toBe(false);
    expect(reminderDue('19:30', at(19, 30), null)).toBe(true);
    expect(reminderDue('19:30', at(19, 30 + SCREEN_REMINDER_CATCH_UP_MIN - 1), null)).toBe(true);
    expect(reminderDue('19:30', at(19, 30 + SCREEN_REMINDER_CATCH_UP_MIN), null)).toBe(false);
  });

  it('une seule fois par jour', () => {
    expect(reminderDue('19:30', at(19, 35), '2026-11-02')).toBe(false);
    expect(reminderDue('19:30', at(19, 35), '2026-11-01')).toBe(true);
  });
});

describe('textes', () => {
  it('routine du soir : ceux qui ont encore des étapes, au singulier ou au pluriel', () => {
    expect(routineReminderText([{ name: 'Léa', left: 2 }, { name: 'Tom', left: 0 }, { name: 'Sam', left: 1 }])).toEqual({
      title: 'Routine du soir',
      subtitle: 'Léa : encore 2 étapes · Sam : encore 1 étape',
    });
    expect(routineReminderText([{ name: 'Léa', left: 0 }])).toBeNull();
  });

  it('mots à lire : des nombres, jamais de texte', () => {
    expect(notesReminderText([{ name: 'Tom', count: 1 }, { name: 'Toute la famille', count: 3 }])).toEqual({
      title: 'Mots à lire sur la tablette',
      subtitle: 'Tom : 1 mot · Toute la famille : 3 mots',
    });
    expect(notesReminderText([])).toBeNull();
  });
});

describe('withDefaults', () => {
  it('un réglage par genre, dans l’ordre, les absents par défaut', () => {
    expect(withDefaults({ notes: { enabled: false, time: '20:00' }, ancien: { enabled: true, time: '08:00' } })).toEqual({
      reminders: [
        { kind: 'evening-routine', ...SCREEN_REMINDER_DEFAULTS['evening-routine'] },
        { kind: 'notes', enabled: false, time: '20:00' },
      ],
    });
  });
});
