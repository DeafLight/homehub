import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Assignment, type Discussion, type Grade, GradeKind, type NotebookAbsence, type NotebookDelay, type Period, type Tab, type TimetableClassLesson } from 'pawnote';
import { describe, expect, it } from 'vitest';
import type { Homework, SchoolAttendance, SchoolCourse, SchoolGrade, SchoolMessage } from '../../shared/types.ts';
import { NOW, silentLogger } from '../testing.ts';
import {
  type PronoteClient,
  type PronoteState,
  type PronoteStateStore,
  createFileStateStore,
  createPronoteSource,
  gradeText,
  matchesChild,
  periodFor,
  toAbsence,
  toCourse,
  toDelay,
  toGrade,
  toHomework,
  toMessage,
} from './pronote.ts';
import { firstSchoolSource } from './types.ts';

const STATE: PronoteState = {
  url: 'https://demo.index-education.net/pronote',
  kind: 7,
  username: 'parent',
  token: 'token-1',
  deviceUUID: 'device',
  navigatorIdentifier: 'nav',
};

const course = (id: string, start: string, end: string): SchoolCourse => ({ id, subject: id, start, end, cancelled: false });
const COURSES = [
  course('maths', '2026-11-02T08:00:00.000Z', '2026-11-02T09:00:00.000Z'),
  course('svt', '2026-11-03T08:00:00.000Z', '2026-11-03T09:00:00.000Z'),
];

const homework = (id: string, due: string, done = false): Homework => ({ id, subject: id, due, text: `Faire ${id}`, done });
const HOMEWORK = [homework('svt', '2026-11-04'), homework('maths', '2026-11-03', true), homework('anglais', '2026-11-03')];

const GRADES: SchoolGrade[] = [{ id: 'g1', subject: 'Mathematiques', date: '2026-10-30', value: '15', outOf: 20 }];
const ATTENDANCE: SchoolAttendance[] = [{ id: 'r1', kind: 'delay', date: '2026-10-29', duration: '5 min', justified: false }];
const MESSAGES: SchoolMessage[] = [{ id: 'm1', subject: 'Sortie', from: 'Mme Durand', date: '2026-10-28T17:00:00.000Z', read: false }];

function memoryStore(initial: PronoteState | null = STATE) {
  let state = initial;
  const saved: string[] = [];
  const store: PronoteStateStore = {
    load: async () => state,
    async save(next) {
      state = next;
      saved.push(next.token);
    },
  };
  return { store, saved, current: () => state };
}

/** Faux Pronote : chaque connexion exige le dernier jeton et en rend un nouveau ; deux connexions à la fois échouent. */
function fakeClient(
  children = ['DUPONT Héloïse', 'DUPONT Jean'],
  homeworkFor: () => Promise<Homework[]> = async () => HOMEWORK,
  gradesFor: () => Promise<SchoolGrade[] | null> = async () => GRADES,
) {
  let token = 'token-1';
  let busy = false;
  const logins: string[] = [];
  const client: PronoteClient = {
    async login(state) {
      if (busy) throw new Error('connexion simultanée');
      if (state.token !== token) throw new Error('jeton refusé');
      busy = true;
      await new Promise((r) => setTimeout(r, 5));
      busy = false;
      logins.push(state.token);
      token = `token-${logins.length + 1}`;
      return {
        state: { ...state, token },
        children,
        timetable: async () => COURSES,
        homework: homeworkFor,
        grades: gradesFor,
        attendance: async () => ATTENDANCE,
        messages: async () => MESSAGES,
      };
    },
  };
  return { client, logins };
}

function setup({ store = memoryStore(), client = fakeClient() } = {}) {
  const logger = silentLogger();
  const children: Record<string, string> = { helo: 'heloise', jean: 'Jean', zoe: 'Zoé' };
  const source = createPronoteSource({
    childFor: (ownerId) => children[ownerId],
    refreshMinutes: () => 60,
    store: store.store,
    client: client.client,
    clock: () => new Date(NOW),
    logger,
  });
  return { source, logger, store, client };
}
const RANGE = { from: new Date('2026-11-02T00:00:00.000Z'), to: new Date('2026-11-04T00:00:00.000Z') };

describe('createPronoteSource', () => {
  it('renvoie null pour un profil sans enfant Pronote', async () => {
    const { source, client } = setup();
    expect(await source.coursesFor('alex', RANGE)).toBeNull();
    expect(client.logins).toHaveLength(0);
  });

  it('sans appairage, renvoie null et le signale une seule fois', async () => {
    const { source, logger } = setup({ store: memoryStore(null) });
    expect(await source.coursesFor('helo', RANGE)).toBeNull();
    expect(await source.coursesFor('helo', RANGE)).toBeNull();
    expect(logger.errors).toEqual([expect.stringContaining('pronote-pair')]);
  });

  it('se connecte, enregistre le nouveau jeton et met l’emploi du temps en cache', async () => {
    const { source, store, client } = setup();
    expect(await source.coursesFor('helo', RANGE)).toEqual(COURSES);
    await source.coursesFor('helo', RANGE);
    expect(client.logins).toEqual(['token-1']);
    expect(store.saved).toEqual(['token-2']);
  });

  it('filtre les cours sur l’intervalle demandé', async () => {
    const { source } = setup();
    const courses = await source.coursesFor('helo', { from: new Date('2026-11-03T00:00:00.000Z'), to: RANGE.to });
    expect(courses?.map((c) => c.id)).toEqual(['svt']);
  });

  it('ne lance jamais deux connexions à la fois : chacune repart du dernier jeton', async () => {
    const { source, client, store } = setup();
    await Promise.all([source.coursesFor('helo', RANGE), source.coursesFor('jean', RANGE)]);
    expect(client.logins).toEqual(['token-1', 'token-2']);
    expect(store.current()?.token).toBe('token-3');
  });

  it('charge les devoirs avec la même connexion, triés par jour puis matière', async () => {
    const { source, client } = setup();
    expect(await source.coursesFor('helo', RANGE)).toEqual(COURSES);
    expect((await source.homeworkFor!('helo'))?.map((h) => h.id)).toEqual(['anglais', 'maths', 'svt']);
    expect(client.logins).toEqual(['token-1']);
    expect(await source.homeworkFor!('alex')).toBeNull();
  });

  it('devoirs indisponibles : les cours restent, les devoirs sont null et l’erreur notée', async () => {
    const client = fakeClient(undefined, async () => {
      throw new Error('onglet fermé');
    });
    const { source, logger } = setup({ client });
    expect(await source.homeworkFor!('helo')).toBeNull();
    expect(await source.coursesFor('helo', RANGE)).toEqual(COURSES);
    expect(logger.errors).toEqual([expect.stringContaining('onglet fermé')]);
  });

  it('charge la vie scolaire avec la même connexion', async () => {
    const { source, client } = setup();
    await source.coursesFor('helo', RANGE);
    expect(await source.lifeFor!('helo')).toEqual({ grades: GRADES, attendance: ATTENDANCE, messages: { service: 'Pronote', items: MESSAGES } });
    expect(client.logins).toEqual(['token-1']);
    expect(await source.lifeFor!('alex')).toBeNull();
  });

  it('notes indisponibles : le reste de la vie scolaire reste, l’erreur est notée', async () => {
    const client = fakeClient(undefined, undefined, async () => {
      throw new Error('onglet Notes fermé');
    });
    const { source, logger } = setup({ client });
    const life = await source.lifeFor!('helo');
    expect(life?.grades).toBeNull();
    expect(life?.attendance).toEqual(ATTENDANCE);
    expect(logger.errors).toEqual([expect.stringContaining('onglet Notes fermé')]);
  });

  it('garde le nouveau jeton même si l’enfant est introuvable', async () => {
    const { source, store } = setup();
    await expect(source.coursesFor('zoe', RANGE)).rejects.toThrow('introuvable');
    expect(store.saved).toEqual(['token-2']);
  });
});

describe('toHomework', () => {
  it('garde le jour local, la consigne en texte, la couleur et la durée', () => {
    const a = {
      id: 'a1',
      subject: { id: 's', name: 'HISTOIRE-GEOGRAPHIE', inGroups: false },
      description: '<p>Lire le <b>chapitre&nbsp;3</b></p><p>Exercice 2</p>',
      backgroundColor: '#C0FFEE',
      done: true,
      deadline: new Date(2026, 10, 5, 0, 0),
      attachments: [{}, {}],
      length: 30,
    } as unknown as Assignment;
    expect(toHomework(a)).toEqual({
      id: 'a1',
      subject: 'Histoire-géographie',
      due: '2026-11-05',
      text: 'Lire le chapitre 3\nExercice 2',
      done: true,
      color: '#C0FFEE',
      attachments: 2,
      minutes: 30,
    });
  });
});

describe('vie scolaire Pronote', () => {
  const value = (points: number, kind: GradeKind = GradeKind.Grade) => ({ kind, points });
  const subject = { id: 's', name: 'MATHEMATIQUES', inGroups: false };

  it('écrit les notes comme Pronote : virgule, abréviations des notes spéciales', () => {
    expect(gradeText(value(15.5))).toBe('15,5');
    expect(gradeText(value(12))).toBe('12');
    expect(gradeText(value(0, GradeKind.Absent))).toBe('Abs');
    expect(gradeText(value(0, GradeKind.Exempted))).toBe('Disp');
    expect(gradeText(value(0, GradeKind.Error))).toBeNull();
  });

  it('convertit une note, avec intitulé, coefficient et moyenne de classe', () => {
    const grade = {
      id: 'g',
      value: value(14.25),
      outOf: value(20),
      date: new Date(2026, 9, 20, 0, 0),
      subject,
      average: value(11.8),
      coefficient: 2,
      comment: ' Contrôle fractions ',
      isBonus: false,
      isOptional: false,
      isOutOf20: false,
    } as unknown as Grade;
    expect(toGrade(grade)).toEqual({
      id: 'g',
      subject: 'Mathématiques',
      date: '2026-10-20',
      value: '14,25',
      outOf: 20,
      title: 'Contrôle fractions',
      coefficient: 2,
      classAverage: '11,8',
    });
    expect(toGrade({ ...grade, value: value(0, GradeKind.Error) })).toBeNull();
    expect(toGrade({ ...grade, coefficient: 1, comment: '', average: undefined })).toEqual({
      id: 'g',
      subject: 'Mathématiques',
      date: '2026-10-20',
      value: '14,25',
      outOf: 20,
    });
  });

  it('convertit absences (en jours ou en heures) et retards', () => {
    const absence = {
      id: 'a',
      startDate: new Date(2026, 9, 12, 8, 0),
      endDate: new Date(2026, 9, 12, 12, 0),
      justified: true,
      opened: false,
      daysMissed: 0,
      hoursMissed: 3,
      minutesMissed: 30,
      shouldParentsJustify: false,
      administrativelyFixed: false,
      isReasonUnknown: false,
      reason: 'Médical',
    } satisfies NotebookAbsence;
    expect(toAbsence(absence)).toEqual({ id: 'a', kind: 'absence', date: '2026-10-12', duration: '3 h 30', justified: true, reason: 'Médical' });
    expect(toAbsence({ ...absence, daysMissed: 2 }).duration).toBe('2 jours');
    const delay = {
      id: 'd',
      date: new Date(2026, 10, 2, 8, 10),
      minutes: 10,
      justified: false,
      shouldParentsJustify: true,
      administrativelyFixed: false,
      isReasonUnknown: true,
    } satisfies NotebookDelay;
    expect(toDelay(delay)).toEqual({ id: 'd', kind: 'delay', date: '2026-11-02', duration: '10 min', justified: false });
  });

  it('résume une discussion sans l’ouvrir : lue s’il ne reste aucun message non lu', () => {
    const discussion = {
      creator: 'M. Martin',
      date: new Date('2026-11-03T08:15:00.000Z'),
      participantsMessageID: 'p1',
      subject: 'Réunion',
      numberOfMessagesUnread: 1,
    } as unknown as Discussion;
    expect(toMessage(discussion)).toEqual({ id: 'p1', subject: 'Réunion', from: 'M. Martin', date: '2026-11-03T08:15:00.000Z', read: false });
    expect(toMessage({ ...discussion, numberOfMessagesUnread: 0, creator: undefined }).read).toBe(true);
  });

  it('lit la période la plus longue qui contient aujourd’hui (l’année plutôt que le trimestre)', () => {
    const period = (id: string, start: Date, end: Date): Period => ({ id, name: id, kind: 0, startDate: start, endDate: end });
    const t1 = period('T1', new Date(2026, 8, 1), new Date(2026, 10, 30));
    const year = period('Année', new Date(2026, 8, 1), new Date(2027, 6, 4));
    const t2 = period('T2', new Date(2026, 11, 1), new Date(2027, 1, 28));
    const tab = (periods: Period[], defaultPeriod?: Period) => ({ location: 198, periods, defaultPeriod }) as Tab;
    expect(periodFor(tab([t1, year, t2]), NOW)?.id).toBe('Année');
    expect(periodFor(tab([t1, t2]), NOW)?.id).toBe('T1');
    expect(periodFor(tab([t2], t2), NOW)?.id).toBe('T2');
    expect(periodFor(undefined, NOW)).toBeNull();
  });
});

describe('createFileStateStore', () => {
  it('relit ce qu’il a écrit, en fichier privé ; null si le fichier n’existe pas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'homehub-pronote-'));
    const store = createFileStateStore(join(dir, 'pronote.json'));
    expect(await store.load()).toBeNull();
    await store.save(STATE);
    expect(await store.load()).toEqual(STATE);
    if (process.platform !== 'win32') expect((await stat(join(dir, 'pronote.json'))).mode & 0o777).toBe(0o600);
  });

  it('accepte un état sans navigatorIdentifier (Pronote ne le donne pas aux connexions mobiles)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'homehub-pronote-'));
    const path = join(dir, 'pronote.json');
    const { navigatorIdentifier: _, ...state } = STATE;
    await writeFile(path, JSON.stringify(state));
    expect(await createFileStateStore(path).load()).toEqual(state);
  });

  it('refuse un fichier incomplet sans en afficher le contenu', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'homehub-pronote-'));
    const path = join(dir, 'pronote.json');
    await writeFile(path, JSON.stringify({ token: 'secret' }));
    await expect(createFileStateStore(path).load()).rejects.toThrow('pronote-pair');
    await expect(createFileStateStore(path).load()).rejects.not.toThrow('secret');
    expect(await readFile(path, 'utf8')).toContain('secret');
  });
});

describe('conversions', () => {
  it('reconnaît le prénom dans « NOM Prénom », sans accents ni casse', () => {
    expect(matchesChild('DUPONT Héloïse', 'heloise')).toBe(true);
    expect(matchesChild('DUPONT Héloïse', 'Dupont')).toBe(true);
    expect(matchesChild('DUPONT Héloïse', 'Hélo')).toBe(false);
  });

  const times = { startDate: new Date(NOW), endDate: new Date(NOW.getTime() + 3_600_000), blockLength: 1, blockPosition: 0, weekNumber: 45 };
  it('convertit cours, activités et retenues', () => {
    const lesson: TimetableClassLesson = {
      ...times,
      id: '1',
      is: 'lesson',
      kind: 0,
      canceled: true,
      exempted: false,
      test: false,
      virtualClassrooms: [],
      personalNames: [],
      teacherNames: ['M. X', 'Mme Y'],
      classrooms: ['225'],
      groupNames: [],
      subject: { id: 's', name: 'HISTOIRE-GEOGRAPHIE', inGroups: false },
    };
    expect(toCourse(lesson)).toMatchObject({ subject: 'Histoire-géographie', room: '225', teacher: 'M. X, Mme Y', cancelled: true });
    expect(toCourse({ ...lesson, classrooms: [], teacherNames: [] })).toMatchObject({ room: undefined, teacher: undefined });
    expect(
      toCourse({ ...times, id: '2', is: 'activity', title: 'Sortie', attendants: [], resourceTypeName: '', resourceValue: '' }),
    ).toMatchObject({ subject: 'Sortie', cancelled: false });
    expect(toCourse({ ...times, id: '3', is: 'detention', personalNames: [], teacherNames: [], classrooms: [] })?.subject).toBe(
      'Retenue',
    );
  });
});

describe('firstSchoolSource', () => {
  it('prend le premier service qui connaît le profil', async () => {
    const none = { coursesFor: async () => null, homeworkFor: async () => null };
    const some = { coursesFor: async () => COURSES };
    expect(await firstSchoolSource(none, some).coursesFor('x', RANGE)).toBe(COURSES);
    expect(await firstSchoolSource(none, none).coursesFor('x', RANGE)).toBeNull();
    const withHomework = { coursesFor: async () => COURSES, homeworkFor: async () => HOMEWORK };
    expect(await firstSchoolSource(none, { coursesFor: async () => null }, withHomework).homeworkFor!('x')).toBe(HOMEWORK);
    expect(await firstSchoolSource(none).homeworkFor!('x')).toBeNull();
    const life = { grades: null, attendance: null, messages: null };
    expect(await firstSchoolSource(none, { coursesFor: async () => null, lifeFor: async () => life }).lifeFor!('x')).toBe(life);
    expect(await firstSchoolSource(none).lifeFor!('x')).toBeNull();
  });
});
