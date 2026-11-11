import { describe, expect, it } from 'vitest';
import { NOW, silentLogger } from '../testing.ts';
import {
  type Credentials,
  createEcoleDirecteClient,
  createEcoleDirecteSource,
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

/** Cahier de texte : résumé par jour, puis détail de chaque jour (consigne en HTML base64). */
const HOMEWORK_DAYS: Record<string, unknown[]> = {
  '2026-11-03': [{ matiere: 'FRANCAIS', aFaire: true, idDevoir: 11 }, { matiere: 'MATHEMATIQUES', aFaire: true, idDevoir: 12 }],
  '2026-11-05': [{ matiere: 'ANGLAIS LV1', aFaire: true, idDevoir: 13 }],
  '2026-12-20': [{ matiere: 'MUSIQUE', aFaire: true, idDevoir: 14 }],
};
const HOMEWORK_DETAIL: Record<string, unknown> = {
  '2026-11-03': {
    date: '2026-11-03',
    matieres: [
      { id: 1, matiere: 'FRANCAIS', interrogation: false, aFaire: { idDevoir: 11, contenu: b64('<p>Lire p.&nbsp;12</p>'), effectue: true, documents: [{ id: 1 }] } },
      { id: 2, matiere: 'MATHEMATIQUES', interrogation: true, aFaire: { idDevoir: 12, contenu: b64('<p>Réviser le chapitre 2</p>'), effectue: false } },
      { id: 3, matiere: 'HISTOIRE', contenuDeSeance: { contenu: b64('<p>Séance</p>') } },
    ],
  },
  '2026-11-05': {
    date: '2026-11-05',
    matieres: [{ id: 4, matiere: 'ANGLAIS LV1', aFaire: { idDevoir: 13, contenu: b64('Learn <i>verbs</i>'), effectue: false } }],
  },
};

/** Faux serveur ÉcoleDirecte : cookie GTK, connexion (question si les jetons ne sont pas les bons), emploi du temps. */
function fakeServer({ courses = COURSES as unknown[], loginCode = 200, homeworkCode = 200 } = {}) {
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
    if (path === 'Eleves/4321/cahierdetexte.awp?get') {
      return homeworkCode === 200 ? json({ code: 200, data: HOMEWORK_DAYS }) : json({ code: homeworkCode, message: 'Accès refusé' });
    }
    const day = /^Eleves\/4321\/cahierdetexte\/(.+)\.awp\?get$/u.exec(path)?.[1];
    if (day && HOMEWORK_DETAIL[day]) return json({ code: 200, data: HOMEWORK_DETAIL[day] });
    return json({ code: 404, message: path });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('conversions', () => {
  it('lit les dates locales (matières : school.test.ts)', () => {
    expect(parseLocalDateTime('2026-11-03 08:35')).toEqual(new Date(2026, 10, 3, 8, 35));
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

  it('lit le cahier de texte : un détail par jour de la fenêtre, consigne en texte, contrôle et pièces jointes', async () => {
    const { fn, calls } = fakeServer();
    const session = await createEcoleDirecteClient(fn).login(CREDENTIALS);
    const homework = await session.homework(4321, new Date(2026, 10, 2), new Date(2026, 10, 23));
    expect(homework).toEqual([
      { id: '11', subject: 'Français', due: '2026-11-03', text: 'Lire p. 12', done: true, attachments: 1 },
      { id: '12', subject: 'Mathématiques', due: '2026-11-03', text: 'Réviser le chapitre 2', done: false, test: true },
      { id: '13', subject: 'Anglais LV1', due: '2026-11-05', text: 'Learn verbs', done: false },
    ]);
    // Hors de la fenêtre (20 décembre) : pas de détail demandé.
    expect(calls.filter((c) => c.startsWith('Eleves/4321/cahierdetexte/'))).toEqual([
      'Eleves/4321/cahierdetexte/2026-11-03.awp?get',
      'Eleves/4321/cahierdetexte/2026-11-05.awp?get',
    ]);
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
  function setup(opts: { student?: string; credentials?: Credentials | undefined; homeworkCode?: number } = {}) {
    const server = fakeServer({ homeworkCode: opts.homeworkCode });
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

  it('donne les devoirs avec la même connexion que l’emploi du temps', async () => {
    const { source, calls } = setup();
    await source.coursesFor('greg', RANGE);
    const logins = calls.length;
    expect((await source.homeworkFor!('greg'))?.map((h) => h.id)).toEqual(['11', '12', '13']);
    expect(calls).toHaveLength(logins);
    expect(await source.homeworkFor!('lea')).toBeNull();
  });

  it('cahier de texte fermé au compte : les cours restent, sans devoirs', async () => {
    const { source, logger } = setup({ homeworkCode: 403 });
    expect(await source.homeworkFor!('greg')).toBeNull();
    expect(await source.coursesFor('greg', RANGE)).toHaveLength(3);
    expect(logger.errors).toEqual([expect.stringContaining('cahier de texte')]);
  });

  it('signale un élève introuvable', async () => {
    const { source, logger } = setup({ student: 'Lucie' });
    await expect(source.coursesFor('greg', RANGE)).rejects.toThrow('introuvable');
    expect(logger.errors.join()).not.toContain('secret');
  });
});
