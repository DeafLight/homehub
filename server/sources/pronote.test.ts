import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TimetableClassLesson } from 'pawnote';
import { describe, expect, it } from 'vitest';
import type { SchoolCourse } from '../../shared/types.ts';
import { NOW, silentLogger } from '../testing.ts';
import {
  type PronoteClient,
  type PronoteState,
  type PronoteStateStore,
  createFileStateStore,
  createPronoteSource,
  matchesChild,
  toCourse,
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
function fakeClient(children = ['DUPONT Héloïse', 'DUPONT Jean']) {
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
      return { state: { ...state, token }, children, timetable: async () => COURSES };
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

  it('garde le nouveau jeton même si l’enfant est introuvable', async () => {
    const { source, store } = setup();
    await expect(source.coursesFor('zoe', RANGE)).rejects.toThrow('introuvable');
    expect(store.saved).toEqual(['token-2']);
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
    expect(toCourse(lesson)).toMatchObject({ subject: 'Histoire-geographie', room: '225', teacher: 'M. X, Mme Y', cancelled: true });
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
    const none = { coursesFor: async () => null };
    const some = { coursesFor: async () => COURSES };
    expect(await firstSchoolSource(none, some).coursesFor('x', RANGE)).toBe(COURSES);
    expect(await firstSchoolSource(none, none).coursesFor('x', RANGE)).toBeNull();
  });
});
