// Tests du résumé de la vie scolaire (bloc du dashboard d'un parent) et des textes du détail.
import { describe, expect, it } from 'vitest';
import type { SchoolAttendance, SchoolGrade, SchoolLife } from '../../../shared/types.ts';
import {
  attendanceStatus,
  attendanceText,
  attendanceTitle,
  childSummaries,
  gradeParts,
  hasSchoolLife,
  messageDayText,
  pastDayText,
  showsSchoolLife,
  unreadCount,
  unreadText,
} from './school-life.ts';

/** Jeudi 5 novembre 2026, 07:35. */
const NOW = new Date(2026, 10, 5, 7, 35);
const grade = (id: string, date: string, value = '15,5', outOf: number | null = 20): SchoolGrade => ({ id, subject: 'Mathematiques', date, value, outOf });
const delay: SchoolAttendance = { id: 'r', kind: 'delay', date: '2026-11-02', duration: '10 minutes', justified: false };
const absence: SchoolAttendance = { id: 'a', kind: 'absence', date: '2026-10-23', duration: '1 demi-journée', justified: true, reason: 'Rendez-vous médical' };

const LIFE: SchoolLife = {
  children: [
    { ownerId: 'lea', grades: [grade('g2', '2026-11-03'), grade('g1', '2026-10-20')], attendance: [delay, absence] },
    { ownerId: 'tom', grades: [], attendance: null },
    { ownerId: 'zoe', grades: null, attendance: null },
  ],
  messages: [
    { service: 'ÉcoleDirecte', items: [{ id: 'm1', subject: 'Réunion', from: 'M. Martin', date: '2026-11-04T16:42:00.000Z', read: false }, { id: 'm2', subject: 'Photos', from: 'Vie scolaire', date: '2026-10-24T08:30:00.000Z', read: true }] },
    { service: 'Pronote', items: [{ id: 'p1', subject: 'Sortie', from: 'Mme Durand', date: '2026-11-01T11:00:00.000Z', read: false }] },
  ],
};

describe('vie scolaire', () => {
  it('n’est demandée que sur le dashboard d’un parent', () => {
    const members = [{ id: 'alex', parent: true }, { id: 'lea', parent: false }];
    expect(showsSchoolLife(members, 'alex')).toBe(true);
    expect(showsSchoolLife(members, 'lea')).toBe(false);
    expect(showsSchoolLife(members, 'famille')).toBe(false);
  });

  it('résume chaque enfant : dernière note, absences, retards, à justifier', () => {
    expect(childSummaries(LIFE)).toEqual([
      { ownerId: 'lea', lastGrade: LIFE.children[0].grades![0], absences: 1, delays: 1, toJustify: 1, unavailable: false },
      { ownerId: 'tom', lastGrade: null, absences: 0, delays: 0, toJustify: 0, unavailable: false },
      { ownerId: 'zoe', lastGrade: null, absences: 0, delays: 0, toJustify: 0, unavailable: true },
    ]);
  });

  it('compte les messages non lus de toutes les messageries', () => {
    expect(unreadCount(LIFE)).toBe(2);
    expect(unreadText(2)).toBe('2 messages non lus');
    expect(unreadText(1)).toBe('1 message non lu');
    expect(unreadText(0)).toBe('Aucun message non lu');
  });

  it('n’a rien à montrer sans enfant suivi ni messagerie', () => {
    expect(hasSchoolLife(LIFE)).toBe(true);
    expect(hasSchoolLife({ children: [], messages: [] })).toBe(false);
    expect(hasSchoolLife(null)).toBe(false);
  });

  it('écrit les notes avec leur barème, sauf les notes spéciales', () => {
    expect(gradeParts(grade('g', '2026-11-03'))).toEqual({ value: '15,5', outOf: '/20' });
    expect(gradeParts(grade('g', '2026-11-03', '8', 10))).toEqual({ value: '8', outOf: '/10' });
    expect(gradeParts(grade('g', '2026-11-03', 'Abs'))).toEqual({ value: 'Abs', outOf: '' });
    expect(gradeParts(grade('g', '2026-11-03', '12', null))).toEqual({ value: '12', outOf: '' });
  });

  it('dit les absences et retards', () => {
    expect(attendanceText({ absences: 1, delays: 2 })).toBe('1 absence · 2 retards');
    expect(attendanceText({ absences: 0, delays: 0 })).toBe('Ni absence ni retard');
    expect(attendanceTitle(delay)).toBe('Retard · 10 minutes');
    expect(attendanceStatus(delay)).toBe('À justifier');
    expect(attendanceStatus(absence)).toBe('Justifiée · rendez-vous médical');
    expect(attendanceStatus({ ...delay, justified: true })).toBe('Justifié');
  });

  it('dit les jours passés comme à l’oral', () => {
    expect(pastDayText('2026-11-05', NOW)).toBe('aujourd’hui');
    expect(pastDayText('2026-11-04', NOW)).toBe('hier');
    expect(pastDayText('2026-11-02', NOW)).toBe('lundi');
    expect(pastDayText('2026-10-23', NOW)).toBe('23 oct.');
    expect(messageDayText(new Date(2026, 10, 4, 17, 42).toISOString(), NOW, true)).toBe('Hier');
  });
});
