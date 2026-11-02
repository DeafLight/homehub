// Emploi du temps ÉcoleDirecte, par l'API privée du site (non officielle, non documentée : elle peut changer).
// Connexion : cookie GTK, puis identifiants et jetons de confiance de l'appareil (cn/cv). Sans jetons valides,
// ÉcoleDirecte pose une question de sécurité : le serveur ne peut pas y répondre, c'est le rôle du script
// d'appairage (scripts/ecoledirecte-pair.ts), qui fournit les jetons à mettre dans app.env.
import { z } from 'zod';
import type { SchoolCourse } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import { createRefreshingCache } from './refreshing-cache.ts';
import type { Clock, SchoolSource, TimeRange } from './types.ts';

const BASE_URL = 'https://api.ecoledirecte.com/v3';
/** Version de l'application web, exigée par l'API. */
const API_VERSION = '4.101.4';
const REQUEST_TIMEOUT_MS = 15_000;
/** En cas de panne, l'emploi du temps reste affiché tant qu'il a moins de 24 h. */
const STALE_MAX_MS = 24 * 3_600_000;
/** Jours chargés à partir d'aujourd'hui. */
const WINDOW_DAYS = 8;
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

const b64decode = (s: string) => Buffer.from(s, 'base64').toString('utf8');
const b64encode = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** « 2026-11-03 08:35 », heure locale de l'établissement (le serveur tourne en Europe/Paris). */
export function parseLocalDateTime(value: string): Date {
  const [y, mo, d, h, mi] = value.split(/[-\s:]/).map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

/** « SCIENCES VIE & TERRE » → « Sciences vie & terre » ; les sigles avec chiffres restent (« Anglais LV1 »). */
export function formatSubject(value: string): string {
  const words = value.trim().toLowerCase().split(/\s+/);
  return words
    .map((w, i) => (/\d/.test(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export const normalizeName = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

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

      return {
        students,
        trust,
        async timetable(studentId, from, to) {
          const { data } = timetableSchema.parse(
            await http.post(`E/${studentId}/emploidutemps.awp?verbe=get`, {
              dateDebut: isoDay(from),
              dateFin: isoDay(to),
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

export type EcoleDirecteSourceDeps = {
  /** Prénom de l'élève associé au profil, ou undefined. Lu à chaque appel (config à chaud). */
  studentFor(ownerId: string): string | undefined;
  refreshMinutes(): number;
  /** Identifiants du compte Famille (variables d'environnement), ou undefined s'ils manquent. */
  credentials(): Credentials | undefined;
  client: EcoleDirecteClient;
  clock: Clock;
  logger: Logger;
};

export function createEcoleDirecteSource({
  studentFor,
  refreshMinutes,
  credentials,
  client,
  clock,
  logger,
}: EcoleDirecteSourceDeps): SchoolSource {
  // Clé : élève et jour de début de la fenêtre, pour recharger au changement de jour.
  const cache = createRefreshingCache<SchoolCourse[]>({
    clock,
    logger,
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
      return session.timetable(student.id, start, new Date(start.getTime() + WINDOW_DAYS * 86_400_000));
    },
  });
  let warnedMissingCredentials = false;

  return {
    async coursesFor(ownerId, range: TimeRange) {
      const prenom = studentFor(ownerId);
      if (!prenom) return null;
      if (!credentials()) {
        if (!warnedMissingCredentials) {
          logger.error('ÉcoleDirecte : ECOLEDIRECTE_IDENTIFIANT ou ECOLEDIRECTE_MOTDEPASSE absent (voir app.env).');
        }
        warnedMissingCredentials = true;
        return null;
      }
      const today = clock();
      today.setHours(0, 0, 0, 0);
      const courses = await cache.get(
        JSON.stringify({ prenom, from: today.toISOString() }),
        refreshMinutes() * 60_000,
        'ÉcoleDirecte',
      );
      return courses.filter((c) => new Date(c.end) > range.from && new Date(c.start) < range.to);
    },
  };
}
