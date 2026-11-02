import { describe, expect, it } from 'vitest';
import { eventLine, formatDay, formatEventWhen, greeting, pluralize, profileHeadline } from './format.ts';

const now = new Date(2026, 10, 2, 18, 0); // lundi 2 novembre, 18:00

describe('formatDay', () => {
  it.each([
    [new Date(2026, 10, 2, 21, 0), 'Aujourd’hui'],
    [new Date(2026, 10, 3, 8, 30), 'Demain'],
    [new Date(2026, 10, 4, 12, 0), 'Mercredi'],
  ])('%s → %s', (date, expected) => {
    expect(formatDay(date, now)).toBe(expected);
  });

  it('au-delà d’une semaine, une date courte', () => {
    expect(formatDay(new Date(2026, 10, 12), now)).toMatch(/12 nov/);
  });
});

describe('profileHeadline', () => {
  it('prochain événement en priorité', () => {
    const start = new Date(2026, 10, 3, 17, 30).toISOString();
    const headline = profileHeadline({ ownerId: 'lea', nextEvent: { id: 'e', title: 'Piscine', start }, pendingTasks: 2 }, now);
    expect(headline).toBe('Piscine · demain à 17:30');
  });

  it('sinon les tâches, sinon rien', () => {
    expect(profileHeadline({ ownerId: 'a', nextEvent: null, pendingTasks: 1 }, now)).toBe('1 tâche à faire');
    expect(profileHeadline({ ownerId: 'a', nextEvent: null, pendingTasks: 0 }, now)).toBe('Rien de prévu');
  });
});

it('greeting', () => {
  expect(greeting(new Date(2026, 10, 2, 9))).toBe('Bonjour');
  expect(greeting(new Date(2026, 10, 2, 20))).toBe('Bonsoir');
});

it('pluralize', () => {
  expect(pluralize(3, 'tâche')).toBe('3 tâches');
});

describe('formatEventWhen sur plusieurs jours', () => {
  const at = (day: number, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

  it.each([
    ['à venir, avec heures', { start: at(6, 18), end: at(8, 14) }, 'Vendredi 18:00 → dimanche 14:00'],
    ['à venir, sur la journée', { start: at(4), end: at(7), allDay: true }, 'Mercredi → vendredi'],
    ['déjà commencé', { start: at(1, 18), end: at(3, 10) }, 'Jusqu’à demain 10:00'],
    ['déjà commencé, sur la journée', { start: at(1), end: at(5), allDay: true }, 'Jusqu’à mercredi'],
    ['un seul jour sur la journée', { start: at(3), end: at(4), allDay: true }, 'Demain'],
    ['un seul jour avec heure', { start: at(3, 8, 30), end: at(3, 9, 30) }, 'Demain à 08:30'],
    ['finit à minuit', { start: at(3, 20), end: at(4) }, 'Demain à 20:00'],
  ])('%s', (_, when, expected) => {
    expect(formatEventWhen({ id: 'x', title: 'X', ...when }, now)).toBe(expected);
  });
});

describe('eventLine', () => {
  it('avec heure, ou sans pour un événement sur la journée', () => {
    const start = new Date(2026, 10, 3, 8, 30).toISOString();
    expect(eventLine({ id: '1', title: 'Dentiste', start }, now)).toBe('Dentiste · demain à 08:30');
    const allDay = new Date(2026, 10, 3).toISOString();
    expect(eventLine({ id: '2', title: 'Anniversaire', start: allDay, allDay: true }, now)).toBe('Anniversaire · demain');
  });
});
