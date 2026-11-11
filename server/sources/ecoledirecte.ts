// Emploi du temps ÉcoleDirecte, par l'API privée du site (non officielle, non documentée : elle peut changer).
// Connexion : cookie GTK, puis identifiants et jetons de confiance de l'appareil (cn/cv). Sans jetons valides,
// ÉcoleDirecte pose une question de sécurité : le serveur ne peut pas y répondre, c'est le rôle du script
// d'appairage (scripts/ecoledirecte-pair.ts), qui fournit les jetons à mettre dans app.env.
// Les devoirs viennent du cahier de texte, avec la même connexion, en lecture seule. L'établissement peut fermer ce
// module au compte Famille : les cours restent alors affichés, sans devoirs.
// Vie scolaire (réservée aux parents) : notes, absences et retards, et la liste des messages reçus, toujours avec la
// même connexion et en lecture seule. On ne lit que la liste des messages, jamais leur contenu : l'ouvrir les
// marquerait lus dans ÉcoleDirecte. Formats d'après la documentation communautaire de l'API (non officielle).
import { z } from 'zod';
import type { Homework, SchoolAttendance, SchoolCourse, SchoolGrade, SchoolMessage } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import { localDay } from '../../shared/dates.ts';
import { homeworkFrom, htmlToText, sortHomework } from './homework.ts';
import { createRefreshingCache } from './refreshing-cache.ts';
import { formatSubject, normalizeName, parseFrenchNumber, schoolYear } from './school.ts';
import type { SourceStatus } from './source-status.ts';
import { type Clock, SCHOOL_WINDOW_DAYS, type SchoolLifeData, type SchoolSource, startOfWeek, type TimeRange } from './types.ts';

const BASE_URL = 'https://api.ecoledirecte.com/v3';
/** Version de l'application web, exigée par l'API. */
const API_VERSION = '4.101.4';
const REQUEST_TIMEOUT_MS = 15_000;
/** En cas de panne, l'emploi du temps reste affiché tant qu'il a moins de 24 h. */
const STALE_MAX_MS = 24 * 3_600_000;
const CODE_OK = 200;
const CODE_DOUBLE_AUTH = 250;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.ecoledirecte.com',
  Referer: 'https://www.ecoledirecte.com/',
};

export type TrustTokens = { cn: string; cv: string };
export type Credentials = { identifiant: string; motdepasse: string; trust?: TrustTokens };
export type Student = { id: number; prenom: string };
/** Répond à la question de sécurité : renvoie la proposition choisie. */
export type AnswerQuestion = (question: string, propositions: string[]) => Promise<string>;

export type EcoleDirecteSession = {
  students: Student[];
  /** Jetons de confiance valides pour les prochaines connexions. */
  trust: TrustTokens | null;
  timetable(studentId: number, from: Date, to: Date): Promise<SchoolCourse[]>;
  /** Devoirs à faire du cahier de texte, des jours compris entre ces deux dates. */
  homework(studentId: number, from: Date, to: Date): Promise<Homework[]>;
  /** Notes de l'année, de la plus récente à la plus ancienne. */
  grades(studentId: number): Promise<SchoolGrade[]>;
  /** Absences et retards de l'année, du plus récent au plus ancien. */
  attendance(studentId: number): Promise<SchoolAttendance[]>;
  /** Messages reçus par le compte cette année scolaire (objet, expéditeur, lu ou non), récents d'abord. */
  messages(now: Date): Promise<SchoolMessage[]>;
};

export class EcoleDirecteError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const envelopeSchema = z.object({ code: z.number(), message: z.string().nullish(), token: z.string().nullish() });
const loginSchema = z.object({
  data: z.object({
    accounts: z.array(
      z.object({
        main: z.boolean().nullish(),
        typeCompte: z.string(),
        id: z.number(),
        prenom: z.string(),
        profile: z.object({ eleves: z.array(z.object({ id: z.number(), prenom: z.string() })).nullish() }).nullish(),
      }),
    ),
  }),
});
const questionSchema = z.object({ data: z.object({ question: z.string(), propositions: z.array(z.string()) }) });
const trustSchema = z.object({ data: z.object({ cn: z.string(), cv: z.string() }) });
const timetableSchema = z.object({
  data: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      matiere: z.string().nullish(),
      text: z.string().nullish(),
      start_date: z.string(),
      end_date: z.string(),
      salle: z.string().nullish(),
      prof: z.string().nullish(),
      isAnnule: z.boolean().nullish(),
    }),
  ),
});

/** Cahier de texte : jours qui ont des devoirs à faire (AAAA-MM-JJ → devoirs du jour, en résumé). */
const homeworkDaysSchema = z.object({
  data: z.record(z.string(), z.array(z.object({ aFaire: z.boolean().nullish() }).loose())).nullish(),
});
/** Détail d'un jour : la consigne (HTML en base64) et l'état de chaque devoir. */
const homeworkDaySchema = z.object({
  data: z.object({
    matieres: z
      .array(
        z
          .object({
            id: z.union([z.number(), z.string()]).nullish(),
            matiere: z.string().nullish(),
            interrogation: z.boolean().nullish(),
            aFaire: z
              .object({
                idDevoir: z.union([z.number(), z.string()]).nullish(),
                contenu: z.string().nullish(),
                effectue: z.boolean().nullish(),
                documents: z.array(z.unknown()).nullish(),
              })
              .loose()
              .nullish(),
          })
          .loose(),
      )
      .nullish(),
  }),
});

/** Carnet de notes : une ligne par devoir noté. */
const gradesSchema = z.object({
  data: z.object({
    notes: z
      .array(
        z
          .object({
            id: z.union([z.number(), z.string()]),
            devoir: z.string().nullish(),
            libelleMatiere: z.string().nullish(),
            codeMatiere: z.string().nullish(),
            date: z.string(),
            valeur: z.string().nullish(),
            noteSur: z.union([z.string(), z.number()]).nullish(),
            coef: z.union([z.string(), z.number()]).nullish(),
            moyenneClasse: z.string().nullish(),
          })
          .loose(),
      )
      .nullish(),
  }),
});
/** Vie scolaire : absences et retards (les sanctions et encouragements ne sont pas repris). */
const attendanceSchema = z.object({
  data: z.object({
    absencesRetards: z
      .array(
        z
          .object({
            id: z.union([z.number(), z.string()]),
            typeElement: z.string(),
            date: z.string(),
            libelle: z.string().nullish(),
            motif: z.string().nullish(),
            justifie: z.boolean().nullish(),
          })
          .loose(),
      )
      .nullish(),
  }),
});
const senderSchema = z
  .object({ name: z.string().nullish(), nom: z.string().nullish(), prenom: z.string().nullish(), civilite: z.string().nullish() })
  .loose();
/** Messagerie : messages reçus (la liste seulement). */
const messagesSchema = z.object({
  data: z.object({
    messages: z
      .object({
        received: z
          .array(
            z
              .object({
                id: z.union([z.number(), z.string()]),
                subject: z.string().nullish(),
                date: z.string(),
                read: z.boolean().nullish(),
                from: senderSchema.nullish(),
              })
              .loose(),
          )
          .nullish(),
      })
      .loose()
      .nullish(),
  }),
});
/** Messages reçus listés au plus. */
const MESSAGES_PAGE = 20;

const b64decode = (s: string) => Buffer.from(s, 'base64').toString('utf8');
const b64encode = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** « 2026-11-03 08:35 », heure locale de l'établissement (le serveur tourne en Europe/Paris). */
export function parseLocalDateTime(value: string): Date {
  const [y, mo, d, h, mi, sec] = value.split(/[-\s:]/).map(Number);
  return new Date(y, mo - 1, d, h, mi, sec || 0);
}

/** « Absence » / « Retard » → genre ; null pour ce qui n'est ni l'un ni l'autre. */
const attendanceKind = (type: string): SchoolAttendance['kind'] | null =>
  /^abs/iu.test(type) ? 'absence' : /^ret/iu.test(type) ? 'delay' : null;

/** Expéditeur lisible : le nom tel qu'ÉcoleDirecte le donne, ou civilité, prénom et nom. */
function senderName(from: z.infer<typeof senderSchema> | null | undefined): string {
  if (from?.name?.trim()) return from.name.trim();
  return [from?.civilite, from?.prenom, from?.nom].filter((p) => p?.trim()).join(' ') || 'Établissement';
}

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}/u.test(value);

/** Session HTTP : cookies et jetons qui tournent à chaque réponse. */
function createHttp(fetchFn: typeof fetch) {
  const cookies = new Map<string, string>();
  let token = '';
  let twofaToken = '';

  const keepCookies = (res: Response) => {
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const i = pair.indexOf('=');
      cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

  async function gtk(): Promise<string> {
    const res = await fetchFn(`${BASE_URL}/login.awp?gtk=1&v=${API_VERSION}`, {
      headers: { ...HEADERS, Cookie: cookieHeader() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    keepCookies(res);
    await res.text();
    const value = cookies.get('GTK');
    if (!value) throw new Error(`cookie GTK absent (HTTP ${res.status})`);
    return value;
  }

  async function post(path: string, payload: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const separator = path.includes('?') ? '&' : '?';
    const res = await fetchFn(`${BASE_URL}/${path}${separator}v=${API_VERSION}`, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader(),
        ...(token && { 'X-Token': token }),
        ...(twofaToken && { '2FA-Token': twofaToken }),
        ...extraHeaders,
      },
      body: `data=${encodeURIComponent(JSON.stringify(payload))}`,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    keepCookies(res);
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`réponse inattendue (HTTP ${res.status})`);
    }
    const envelope = envelopeSchema.parse(body);
    token = res.headers.get('x-token') || envelope.token || token;
    twofaToken = res.headers.get('2fa-token') || twofaToken;
    if (envelope.code !== CODE_OK && envelope.code !== CODE_DOUBLE_AUTH) {
      throw new EcoleDirecteError(envelope.code, envelope.message || `code ${envelope.code}`);
    }
    return body;
  }

  return { gtk, post };
}

export function createEcoleDirecteClient(fetchFn: typeof fetch = (...args) => fetch(...args)) {
  return {
    /**
     * Ouvre une session. Sans `answerQuestion`, une question de sécurité (jetons absents ou expirés) est une
     * erreur : il faut relancer le script d'appairage.
     */
    async login(credentials: Credentials, answerQuestion?: AnswerQuestion): Promise<EcoleDirecteSession> {
      const http = createHttp(fetchFn);
      const doLogin = async (trust: TrustTokens | null, extra: object = {}) =>
        envelopeSchema.loose().parse(
          await http.post(
            'login.awp',
            {
              identifiant: credentials.identifiant,
              motdepasse: credentials.motdepasse,
              isReLogin: false,
              uuid: '',
              fa: trust ? [{ ...trust, uniq: false }] : [],
              ...extra,
            },
            { 'X-Gtk': await http.gtk() },
          ),
        );

      let trust = credentials.trust ?? null;
      let body = await doLogin(trust);
      if (body.code === CODE_DOUBLE_AUTH) {
        if (!answerQuestion) {
          throw new EcoleDirecteError(
            CODE_DOUBLE_AUTH,
            'question de sécurité demandée : jetons ECOLEDIRECTE_CN/CV absents ou expirés, relancer scripts/ecoledirecte-pair.ts',
          );
        }
        const { data } = questionSchema.parse(await http.post('connexion/doubleauth.awp?verbe=get', {}));
        const propositions = data.propositions.map(b64decode);
        const choice = await answerQuestion(b64decode(data.question), propositions);
        trust = trustSchema.parse(
          await http.post('connexion/doubleauth.awp?verbe=post', { choix: b64encode(choice) }),
        ).data;
        body = await doLogin(trust, trust);
      }
      if (body.code !== CODE_OK) throw new EcoleDirecteError(body.code, body.message || 'connexion refusée');

      const { accounts } = loginSchema.parse(body).data;
      const account = accounts.find((a) => a.main) ?? accounts[0];
      const students =
        account.typeCompte === 'E'
          ? [{ id: account.id, prenom: account.prenom }]
          : (account.profile?.eleves ?? []).map(({ id, prenom }) => ({ id, prenom }));

      // La messagerie d'un compte Famille est celle du compte, pas d'un élève.
      const mailbox = account.typeCompte === 'E' ? `eleves/${account.id}` : `familles/${account.id}`;

      return {
        students,
        trust,
        async grades(studentId) {
          const { data } = gradesSchema.parse(await http.post(`eleves/${studentId}/notes.awp?verbe=get`, { anneeScolaire: '' }));
          return (data.notes ?? [])
            .filter((n) => n.valeur?.trim() && isDay(n.date))
            .map((n): SchoolGrade => {
              const coefficient = parseFrenchNumber(n.coef);
              return {
                id: String(n.id),
                subject: formatSubject(n.libelleMatiere || n.codeMatiere || 'Note'),
                date: n.date.slice(0, 10),
                value: (n.valeur ?? '').trim(),
                outOf: parseFrenchNumber(n.noteSur),
                ...(n.devoir?.trim() && { title: n.devoir.trim() }),
                ...(coefficient !== null && coefficient !== 1 && { coefficient }),
                ...(n.moyenneClasse?.trim() && { classAverage: n.moyenneClasse.trim() }),
              };
            })
            .sort((a, b) => b.date.localeCompare(a.date));
        },
        async attendance(studentId) {
          const { data } = attendanceSchema.parse(await http.post(`eleves/${studentId}/viescolaire.awp?verbe=get`, {}));
          return (data.absencesRetards ?? [])
            .flatMap((a): SchoolAttendance[] => {
              const kind = attendanceKind(a.typeElement);
              if (!kind || !isDay(a.date)) return [];
              return [
                {
                  id: String(a.id),
                  kind,
                  date: a.date.slice(0, 10),
                  duration: a.libelle?.trim() || (kind === 'absence' ? 'Absence' : 'Retard'),
                  justified: a.justifie === true,
                  ...(a.motif?.trim() && { reason: a.motif.trim() }),
                },
              ];
            })
            .sort((a, b) => b.date.localeCompare(a.date));
        },
        async messages(now) {
          const query = new URLSearchParams({
            force: 'false',
            typeRecuperation: 'received',
            idClasseur: '0',
            orderBy: 'date',
            order: 'desc',
            query: '',
            onlyRead: '',
            page: '0',
            itemsPerPage: String(MESSAGES_PAGE),
            getAll: '0',
            verbe: 'get',
          });
          const { data } = messagesSchema.parse(await http.post(`${mailbox}/messages.awp?${query}`, { anneeMessages: schoolYear(now) }));
          return (data.messages?.received ?? [])
            .map((m) => ({
              id: String(m.id),
              subject: m.subject?.trim() || '(sans objet)',
              from: senderName(m.from),
              date: parseLocalDateTime(m.date).toISOString(),
              read: m.read !== false,
            }))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, MESSAGES_PAGE);
        },
        async homework(studentId, from, to) {
          const days = homeworkDaysSchema.parse(
            await http.post(`Eleves/${studentId}/cahierdetexte.awp?verbe=get`, {}),
          ).data;
          const wanted = Object.entries(days ?? {})
            .filter(([day]) => /^\d{4}-\d{2}-\d{2}$/u.test(day) && day >= localDay(from) && day < localDay(to))
            .filter(([, items]) => items.some((i) => i.aFaire !== false))
            .map(([day]) => day)
            .sort();
          const homework: Homework[] = [];
          // Un jour après l'autre : la session ÉcoleDirecte fait tourner son jeton à chaque réponse.
          for (const day of wanted) {
            const { data } = homeworkDaySchema.parse(
              await http.post(`Eleves/${studentId}/cahierdetexte/${day}.awp?verbe=get`, {}),
            );
            for (const m of data.matieres ?? []) {
              if (!m.aFaire) continue;
              const documents = m.aFaire.documents?.length ?? 0;
              homework.push({
                id: String(m.aFaire.idDevoir ?? m.id ?? `${day}-${homework.length}`),
                subject: formatSubject(m.matiere || 'Devoir'),
                due: day,
                text: m.aFaire.contenu ? htmlToText(b64decode(m.aFaire.contenu)) : '',
                done: m.aFaire.effectue === true,
                ...(m.interrogation && { test: true }),
                ...(documents > 0 && { attachments: documents }),
              });
            }
          }
          return homework;
        },
        async timetable(studentId, from, to) {
          const { data } = timetableSchema.parse(
            await http.post(`E/${studentId}/emploidutemps.awp?verbe=get`, {
              dateDebut: localDay(from),
              dateFin: localDay(to),
              avecTrous: false,
            }),
          );
          return data
            .map((c) => ({
              id: String(c.id),
              subject: formatSubject(c.matiere || c.text || 'Cours'),
              start: parseLocalDateTime(c.start_date).toISOString(),
              end: parseLocalDateTime(c.end_date).toISOString(),
              ...(c.salle?.trim() && { room: c.salle.trim() }),
              ...(c.prof?.trim() && { teacher: c.prof.trim() }),
              cancelled: c.isAnnule === true,
            }))
            .sort((a, b) => a.start.localeCompare(b.start));
        },
      };
    },
  };
}

export type EcoleDirecteClient = ReturnType<typeof createEcoleDirecteClient>;

type SchoolData = { courses: SchoolCourse[]; homework: Homework[] | null; life: SchoolLifeData };

export type EcoleDirecteSourceDeps = {
  /** Prénom de l'élève associé au profil, ou undefined. Lu à chaque appel (config à chaud). */
  studentFor(ownerId: string): string | undefined;
  refreshMinutes(): number;
  /** Identifiants du compte Famille (variables d'environnement), ou undefined s'ils manquent. */
  credentials(): Credentials | undefined;
  client: EcoleDirecteClient;
  clock: Clock;
  logger: Logger;
  /** Résultat de chaque chargement, pour la page « Le NAS ». */
  status?: SourceStatus;
};

export function createEcoleDirecteSource({
  studentFor,
  refreshMinutes,
  credentials,
  client,
  clock,
  logger,
  status,
}: EcoleDirecteSourceDeps): SchoolSource {
  // Clé : élève et début de la fenêtre (lundi de la semaine en cours), pour recharger au changement de semaine.
  // Devoirs chargés avec l'emploi du temps (une seule connexion) ; leur échec n'empêche pas d'afficher les cours.
  const cache = createRefreshingCache<SchoolData>({
    clock,
    logger,
    status,
    staleMaxMs: STALE_MAX_MS,
    async load(key) {
      const { prenom, from } = JSON.parse(key) as { prenom: string; from: string };
      const creds = credentials();
      if (!creds) throw new Error('identifiants absents');
      const session = await client.login(creds);
      const student = session.students.find((s) => normalizeName(s.prenom) === normalizeName(prenom));
      if (!student) {
        throw new Error(`élève « ${prenom} » introuvable (élèves du compte : ${session.students.map((s) => s.prenom).join(', ')})`);
      }
      const start = new Date(from);
      const end = new Date(start.getTime() + SCHOOL_WINDOW_DAYS * 86_400_000);
      const courses = await session.timetable(student.id, start, end);
      let homework: Homework[] | null = null;
      try {
        homework = sortHomework(await session.homework(student.id, start, end));
      } catch (err) {
        logger.error(`ÉcoleDirecte : devoirs de ${prenom} indisponibles (cahier de texte fermé au compte Famille ?) : ${(err as Error).message}.`);
      }
      // Vie scolaire : chaque rubrique peut être fermée au compte Famille ; son échec ne masque que cette rubrique.
      const part = async <T>(label: string, task: () => Promise<T>): Promise<T | null> => {
        try {
          return await task();
        } catch (err) {
          logger.error(`ÉcoleDirecte : ${label} de ${prenom} indisponibles : ${(err as Error).message}.`);
          return null;
        }
      };
      const grades = await part('notes', () => session.grades(student.id));
      const attendance = await part('absences et retards', () => session.attendance(student.id));
      const messages = await part('messages', () => session.messages(clock()));
      return { courses, homework, life: { grades, attendance, messages: messages && { service: 'ÉcoleDirecte', items: messages } } };
    },
  });
  let warnedMissingCredentials = false;

  /** Données de la semaine pour ce profil ; null s'il n'est pas sur ÉcoleDirecte ou si les identifiants manquent. */
  async function dataFor(ownerId: string): Promise<SchoolData | null> {
    const prenom = studentFor(ownerId);
    if (!prenom) return null;
    if (!credentials()) {
      if (!warnedMissingCredentials) {
        logger.error('ÉcoleDirecte : ECOLEDIRECTE_IDENTIFIANT ou ECOLEDIRECTE_MOTDEPASSE absent (voir app.env).');
      }
      warnedMissingCredentials = true;
      return null;
    }
    const monday = startOfWeek(clock());
    return cache.get(JSON.stringify({ prenom, from: monday.toISOString() }), refreshMinutes() * 60_000, 'ÉcoleDirecte');
  }

  return {
    async coursesFor(ownerId, range: TimeRange) {
      const data = await dataFor(ownerId);
      return data && data.courses.filter((c) => new Date(c.end) > range.from && new Date(c.start) < range.to);
    },
    async homeworkFor(ownerId) {
      const homework = (await dataFor(ownerId))?.homework;
      return homework ? homeworkFrom(homework, clock()) : null;
    },
    async lifeFor(ownerId) {
      return (await dataFor(ownerId))?.life ?? null;
    },
  };
}
