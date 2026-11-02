import { describe, expect, it } from 'vitest';
import { NOW, silentLogger } from '../testing.ts';
import {
  type Credentials,
  createEcoleDirecteClient,
  createEcoleDirecteSource,
  formatSubject,
  parseLocalDateTime,
} from './ecoledirecte.ts';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const TRUST = { cn: 'cn-ok', cv: 'cv-ok' };
const CREDENTIALS: Credentials = { identifiant: 'parent', motdepasse: 'secret', trust: TRUST };

const COURSES = [
  { id: 2, matiere: 'PHYSIQUE-CHIMIE', start_date: '2026-11-02 13:55', end_date: '2026-11-02 15:20', salle: 'C05 ', prof: 'M. X', isAnnule: false },
  { id: 1, matiere: 'ANGLAIS LV1', start_date: '2026-11-02 08:35', end_date: '2026-11-02 10:00', salle: 'B26', isAnnule: true },
  { id: 3, matiere: '', text: 'Sortie', start_date: '2026-11-03 09:00', end_date: '2026-11-03 12:00', salle: '' },
];

/** Faux serveur ÉcoleDirecte : cookie GTK, connexion (question si les jetons ne sont pas les bons), emploi du temps. */
function fakeServer({ courses = COURSES as unknown[], loginCode = 200 } = {}) {
  const calls: string[] = [];
  const fn = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace('/v3/', '') + (url.searchParams.get('verbe') ? `?${url.searchParams.get('verbe')}` : '');
    calls.push(path);
    if (url.searchParams.has('gtk')) {
      return new Response('', { headers: { 'Set-Cookie': 'GTK=gtk-value; Path=/' } });
    }
    const headers = new Headers(init?.headers);
    const payload = JSON.parse(decodeURIComponent(String(init?.body).slice('data='.length)));
    const json = (body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { headers: { 'x-token': 'token-2', ...extra } });

    if (path === 'login.awp') {
      if (headers.get('X-Gtk') !== 'gtk-value') return json({ code: 517, message: 'GTK manquant' });
      if (payload.motdepasse !== 'secret') return json({ code: 505, message: 'Identifiant et/ou mot de passe invalide !' });
      if (payload.fa[0]?.cn !== TRUST.cn) return json({ code: 250, token: 'token-1' }, { '2fa-token': '2fa' });
      if (loginCode !== 200) return json({ code: loginCode, message: 'Erreur' });
      return json({
        code: 200,
        token: 'token-1',
        data: { accounts: [{ main: true, typeCompte: '1', id: 9, prenom: 'Parent', profile: { eleves: [{ id: 4321, prenom: 'Héloïse' }] } }] },
      });
    }
    if (path === 'connexion/doubleauth.awp?get') {
      if (headers.get('2FA-Token') !== '2fa') return json({ code: 520, message: 'Token invalide !' });
      return json({ code: 200, data: { question: b64('Jour de naissance ?'), propositions: [b64('5'), b64('6')] } });
    }
    if (path === 'connexion/doubleauth.awp?post') {
      return payload.choix === b64('6') ? json({ code: 200, data: TRUST }) : json({ code: 520, message: 'Mauvaise réponse' });
    }
    if (path === 'E/4321/emploidutemps.awp?get') {
      if (headers.get('X-Token') !== 'token-2') return json({ code: 525, message: 'Token invalide' });
      return json({ code: 200, data: courses });
    }
    return json({ code: 404, message: path });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('conversions', () => {
  it('lit les dates locales et met en forme les matières', () => {
    expect(parseLocalDateTime('2026-11-03 08:35')).toEqual(new Date(2026, 10, 3, 8, 35));
    expect(formatSubject('SCIENCES VIE & TERRE')).toBe('Sciences vie & terre');
    expect(formatSubject('ANGLAIS LV1')).toBe('Anglais LV1');
  });
});

describe('createEcoleDirecteClient', () => {
  it('se connecte avec les jetons de confiance et lit l’emploi du temps', async () => {
    const { fn } = fakeServer();
    const session = await createEcoleDirecteClient(fn).login(CREDENTIALS);
    expect(session.students).toEqual([{ id: 4321, prenom: 'Héloïse' }]);

    const courses = await session.timetable(4321, NOW, NOW);
    expect(courses.map((c) => c.subject)).toEqual(['Anglais LV1', 'Physique-chimie', 'Sortie']);
    expect(courses[0]).toMatchObject({ cancelled: true, room: 'B26' });
    expect(courses[1]).toMatchObject({ cancelled: false, room: 'C05', teacher: 'M. X' });
    expect(courses[2].room).toBeUndefined();
  });

  it('répond à la question de sécurité quand les jetons manquent', async () => {
    const { fn } = fakeServer();
    const asked: string[] = [];
    const session = await createEcoleDirecteClient(fn).login(
      { identifiant: 'parent', motdepasse: 'secret' },
      async (question, propositions) => {
        asked.push(question, ...propositions);
        return '6';
      },
    );
    expect(asked).toEqual(['Jour de naissance ?', '5', '6']);
    expect(session.trust).toEqual(TRUST);
  });

  it('sans réponse possible, une question de sécurité est une erreur explicite', async () => {
    const { fn } = fakeServer();
    await expect(
      createEcoleDirecteClient(fn).login({ identifiant: 'parent', motdepasse: 'secret', trust: { cn: 'x', cv: 'y' } }),
    ).rejects.toThrow(/ecoledirecte-pair/);
  });

  it('remonte le message d’ÉcoleDirecte en cas de refus', async () => {
    const { fn } = fakeServer();
    await expect(createEcoleDirecteClient(fn).login({ ...CREDENTIALS, motdepasse: 'faux' })).rejects.toThrow(
      'mot de passe invalide',
    );
  });
});

describe('createEcoleDirecteSource', () => {
  function setup(opts: { student?: string; credentials?: Credentials | undefined } = {}) {
    const server = fakeServer();
    const logger = silentLogger();
    const source = createEcoleDirecteSource({
      studentFor: (ownerId) => (ownerId === 'greg' ? (opts.student ?? 'heloise') : undefined),
      refreshMinutes: () => 60,
      credentials: () => ('credentials' in opts ? opts.credentials : CREDENTIALS),
      client: createEcoleDirecteClient(server.fn),
      clock: () => NOW,
      logger,
    });
    return { source, logger, calls: server.calls };
  }
  const RANGE = { from: new Date(2026, 10, 2), to: new Date(2026, 10, 4) };

  it('renvoie null pour un profil sans élève', async () => {
    const { source, calls } = setup();
    expect(await source.coursesFor('lea', RANGE)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('trouve l’élève sans tenir compte des accents, et met l’emploi du temps en cache', async () => {
    const { source, calls } = setup();
    expect(await source.coursesFor('greg', RANGE)).toHaveLength(3);
    await source.coursesFor('greg', { from: new Date(2026, 10, 3), to: new Date(2026, 10, 4) });
    expect(calls.filter((c) => c.includes('emploidutemps'))).toHaveLength(1);
  });

  it('filtre les cours sur l’intervalle demandé', async () => {
    const { source } = setup();
    const courses = await source.coursesFor('greg', { from: new Date(2026, 10, 3), to: new Date(2026, 10, 4) });
    expect(courses?.map((c) => c.subject)).toEqual(['Sortie']);
  });

  it('signale une seule fois des identifiants absents', async () => {
    const { source, logger } = setup({ credentials: undefined });
    expect(await source.coursesFor('greg', RANGE)).toBeNull();
    expect(await source.coursesFor('greg', RANGE)).toBeNull();
    expect(logger.errors).toEqual([expect.stringContaining('ECOLEDIRECTE_IDENTIFIANT')]);
  });

  it('signale un élève introuvable', async () => {
    const { source, logger } = setup({ student: 'Lucie' });
    await expect(source.coursesFor('greg', RANGE)).rejects.toThrow('introuvable');
    expect(logger.errors.join()).not.toContain('secret');
  });
});
