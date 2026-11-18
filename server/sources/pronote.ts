// Emploi du temps Pronote, par Pawnote (bibliothèque non officielle qui imite l'application mobile ; corrigée pour
// Pronote 2026 par scripts/patch-pawnote.ts). Connexion par jeton, comme l'application : le jeton de départ vient
// du QR code de Pronote (scripts/pronote-pair.ts), et Pronote en donne un nouveau à chaque connexion. Il est donc
// réenregistré aussitôt dans un fichier : l'ancien ne sert plus, le perdre oblige à refaire l'appairage.
// Les devoirs (cahier de texte) viennent de la même connexion, en lecture seule. De même la vie scolaire, réservée aux
// parents : notes et carnet (absences, retards) de la période en cours, et la liste des discussions de la messagerie,
// sans ouvrir leurs messages (Pronote les marquerait lus).
// Pronote limite les connexions (« You've been rate-limited », adresse IP suspendue) : une seule connexion par cycle
// pour tous les enfants, aucune la nuit tant que les données restent utilisables, un rythme plus lent le week-end,
// la vie scolaire relue toutes les 3 h seulement, et un long recul après un échec (6 h si Pronote limite).
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import * as pawnote from 'pawnote';
import { z } from 'zod';
import type { Homework, SchoolAttendance, SchoolCourse, SchoolGrade, SchoolMessage } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import { homeworkFrom, htmlToText, sortHomework } from './homework.ts';
import { durationLabel, formatFrenchNumber, formatSubject, normalizeName } from './school.ts';
import { localDay } from '../../shared/dates.ts';
import { createRefreshingCache } from './refreshing-cache.ts';
import type { SourceStatus } from './source-status.ts';
import { type Clock, SCHOOL_WINDOW_DAYS, type SchoolLifeData, type SchoolSource, startOfWeek, type TimeRange } from './types.ts';

const REQUEST_TIMEOUT_MS = 15_000;
/**
 * En cas de panne, l'emploi du temps reste affiché tant qu'il a moins de 48 h : plus long que la nuit sans connexion
 * suivie de plusieurs pauses après échec.
 */
export const STALE_MAX_MS = 48 * 3_600_000;
/** Recul après un échec : 15 min, puis 30 min, 1 h… jusqu'à 6 h ; remis à zéro au premier succès. */
const RETRY_FIRST_MS = 15 * 60_000;
const RETRY_MAX_MS = 6 * 3_600_000;
/** Pause quand Pronote limite les requêtes ou suspend l'adresse IP : chaque essai entretiendrait le blocage. */
export const RATE_LIMIT_PAUSE_MS = 6 * 3_600_000;
/** Nuit sans connexion (heure locale), tant que les données sont utilisables. */
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;
/** Le week-end, l'emploi du temps est relu trois fois moins souvent. */
const WEEKEND_FACTOR = 3;
/** Notes, carnet et messagerie : relus au plus toutes les 3 h (ou à `refreshMinutes` s'il est plus long). */
export const LIFE_REFRESH_MS = 3 * 3_600_000;
const PAIRING_HINT = 'refaire l’appairage (scripts/pronote-pair.ts, voir README)';

/** Ce qu'il faut pour se reconnecter : le format de RefreshInformation de Pawnote, plus l'appareil. */
export const pronoteStateSchema = z.object({
  url: z.string().url(),
  kind: z.number(),
  username: z.string().min(1),
  token: z.string().min(1),
  deviceUUID: z.string().min(1),
  /** Absent pour une connexion par QR code ou jeton : Pronote ne le renvoie pas. */
  navigatorIdentifier: z.string().optional(),
});
export type PronoteState = z.infer<typeof pronoteStateSchema>;

export interface PronoteStateStore {
  /** null si l'appairage n'a pas été fait. */
  load(): Promise<PronoteState | null>;
  save(state: PronoteState): Promise<void>;
}

export type PronoteSession = {
  /** État à enregistrer pour la prochaine connexion (nouveau jeton). */
  state: PronoteState;
  /** Noms des enfants du compte, tels que Pronote les donne (« NOM Prénom »). */
  children: string[];
  timetable(child: string, from: Date, to: Date): Promise<SchoolCourse[]>;
  /** Devoirs à faire entre ces deux dates. */
  homework(child: string, from: Date, to: Date): Promise<Homework[]>;
  /**
   * Notes de la période en cours, récentes d'abord, avec les noms des périodes lues pour les trouver ; null si
   * l'onglet est fermé au compte. `preferred` : période où les notes ont été trouvées la dernière fois, lue d'abord.
   */
  grades(child: string, now: Date, preferred?: string): Promise<{ items: SchoolGrade[]; periods: string[] } | null>;
  /** Absences et retards de la période en cours, récents d'abord ; null si l'onglet est fermé au compte. */
  attendance(child: string, now: Date): Promise<SchoolAttendance[] | null>;
  /** Discussions de la messagerie du compte, récentes d'abord ; null si le compte ne peut pas les lire. */
  messages(): Promise<SchoolMessage[] | null>;
};

export interface PronoteClient {
  login(state: PronoteState): Promise<PronoteSession>;
}

/** Fichier JSON (droits 600), écrit dans un fichier temporaire puis renommé : jamais à moitié écrit. */
export function createFileStateStore(path: string): PronoteStateStore {
  return {
    async load() {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
      const result = pronoteStateSchema.safeParse(JSON.parse(text));
      if (!result.success) throw new Error(`${path} illisible : ${PAIRING_HINT}`);
      return result.data;
    },
    async save(state) {
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, path);
    },
  };
}

/** Vrai si le nom Pronote (« NOM Prénom ») contient ce prénom, sans tenir compte des accents ni de la casse. */
export function matchesChild(pronoteName: string, prenom: string): boolean {
  const wanted = normalizeName(prenom);
  return pronoteName.split(/\s+/u).some((word) => normalizeName(word) === wanted);
}

type PawnoteClass = pawnote.Timetable['classes'][number];

/** Un créneau Pawnote en cours ; null pour ce qui n'a pas sa place sur la frise. */
export function toCourse(c: PawnoteClass): SchoolCourse | null {
  const base = { id: c.id, start: c.startDate.toISOString(), end: c.endDate.toISOString() };
  const list = (values: string[] | undefined) => (values?.length ? values.join(', ') : undefined);
  switch (c.is) {
    case 'lesson':
      return {
        ...base,
        subject: formatSubject(c.subject?.name ?? c.notes ?? 'Cours'),
        room: list(c.classrooms),
        teacher: list(c.teacherNames),
        cancelled: c.canceled,
      };
    case 'activity':
      return { ...base, subject: c.title, cancelled: false };
    case 'detention':
      return { ...base, subject: c.title ?? 'Retenue', room: list(c.classrooms), cancelled: false };
    default:
      return null;
  }
}

/** Un devoir Pawnote. */
export function toHomework(a: pawnote.Assignment): Homework {
  return {
    id: a.id,
    subject: formatSubject(a.subject.name),
    due: localDay(a.deadline),
    text: htmlToText(a.description),
    done: a.done,
    ...(/^#[0-9a-f]{6}$/iu.test(a.backgroundColor) && { color: a.backgroundColor }),
    ...(a.attachments.length > 0 && { attachments: a.attachments.length }),
    ...(a.length && { minutes: a.length }),
  };
}

/** Discussions listées au plus. */
const MESSAGES_LIMIT = 20;

/** Note Pawnote telle que Pronote l'écrit : « 15,5 », ou les abréviations des notes spéciales ; null pour une erreur. */
export function gradeText(value: pawnote.GradeValue): string | null {
  switch (value.kind) {
    case pawnote.GradeKind.Grade:
      return formatFrenchNumber(value.points);
    case pawnote.GradeKind.Absent:
      return 'Abs';
    case pawnote.GradeKind.AbsentZero:
      return 'Abs (0)';
    case pawnote.GradeKind.Exempted:
      return 'Disp';
    case pawnote.GradeKind.NotGraded:
      return 'N.Not';
    case pawnote.GradeKind.Unfit:
      return 'Inap';
    case pawnote.GradeKind.Unreturned:
      return 'N.Rdu';
    case pawnote.GradeKind.UnreturnedZero:
      return 'N.Rdu (0)';
    case pawnote.GradeKind.Congratulations:
      return 'Félicitations';
    default:
      return null;
  }
}

/** Une note Pawnote ; null pour une note en erreur. */
export function toGrade(g: pawnote.Grade): SchoolGrade | null {
  const value = gradeText(g.value);
  if (value === null) return null;
  const average = g.average && gradeText(g.average);
  return {
    id: g.id,
    subject: formatSubject(g.subject.name),
    date: localDay(g.date),
    value,
    outOf: g.outOf.kind === pawnote.GradeKind.Grade ? g.outOf.points : null,
    // Pronote omet le commentaire quand il est vide.
    ...(g.comment?.trim() && { title: g.comment.trim() }),
    ...(g.coefficient !== 1 && { coefficient: g.coefficient }),
    ...(average && { classAverage: average }),
  };
}

/** Une absence du carnet : en jours si elle en compte, sinon en heures. */
export function toAbsence(a: pawnote.NotebookAbsence): SchoolAttendance {
  const duration =
    a.daysMissed > 0 ? `${a.daysMissed} jour${a.daysMissed > 1 ? 's' : ''}` : durationLabel(a.hoursMissed * 60 + a.minutesMissed);
  return {
    id: a.id,
    kind: 'absence',
    date: localDay(a.startDate),
    duration,
    justified: a.justified,
    ...(a.reason?.trim() && { reason: a.reason.trim() }),
  };
}

export function toDelay(d: pawnote.NotebookDelay): SchoolAttendance {
  const reason = d.reason?.trim() || d.justification?.trim();
  return { id: d.id, kind: 'delay', date: localDay(d.date), duration: durationLabel(d.minutes), justified: d.justified, ...(reason && { reason }) };
}

/** Une discussion : son objet, qui l'a ouverte, et lue s'il n'y reste aucun message non lu. */
export function toMessage(d: pawnote.Discussion): SchoolMessage {
  return {
    id: d.participantsMessageID,
    subject: d.subject.trim() || '(sans objet)',
    from: d.creator?.trim() || d.recipientName?.trim() || 'Établissement',
    date: d.date.toISOString(),
    read: d.numberOfMessagesUnread === 0,
  };
}

/** Genre d'une période dans les requêtes Pronote (« G »), le même pour toutes. */
const PERIOD_KIND = 2;

/**
 * Période d'un onglet à lire : celle qui contient aujourd'hui et couvre le plus de jours (l'année plutôt que le
 * trimestre, quand l'établissement la propose), sinon celle par défaut ; null si l'onglet est fermé au compte.
 * Pronote 2026 ne donne plus le genre des périodes (General.ListePeriodes sans « G ») : sans lui, la requête des notes
 * revient vide, sans erreur. On le remet.
 */
export function periodFor(tab: pawnote.Tab | undefined, now: Date): pawnote.Period | null {
  if (!tab) return null;
  const span = (p: pawnote.Period) => p.endDate.getTime() - p.startDate.getTime();
  const current = tab.periods.filter((p) => p.startDate <= now && now <= p.endDate).sort((a, b) => span(b) - span(a));
  const period = current[0] ?? tab.defaultPeriod;
  return period ? withKind(period) : null;
}

const withKind = (p: pawnote.Period): pawnote.Period => ({ ...p, kind: p.kind ?? PERIOD_KIND });

/** Périodes lues au plus pour trouver des notes (une requête chacune). */
const GRADE_PERIODS_MAX = 3;

/**
 * Périodes où chercher les notes, dans l'ordre : celle par défaut de Pronote (celle que montre le site, où
 * l'établissement range ses notes), puis les autres qui contiennent aujourd'hui, la plus courte d'abord. Un
 * établissement qui note par semestre peut aussi proposer trimestres et année : elles reviennent vides.
 */
export function gradePeriods(tab: pawnote.Tab | undefined, now: Date): pawnote.Period[] {
  if (!tab) return [];
  const span = (p: pawnote.Period) => p.endDate.getTime() - p.startDate.getTime();
  const current = tab.periods.filter((p) => p.startDate <= now && now <= p.endDate).sort((a, b) => span(a) - span(b));
  const ordered = tab.defaultPeriod ? [tab.defaultPeriod, ...current] : current;
  const unique = ordered.filter((p, i) => ordered.findIndex((q) => q.id === p.id) === i);
  return unique.slice(0, GRADE_PERIODS_MAX).map(withKind);
}

/** Met en tête la période de ce nom (celle où les notes ont été trouvées la dernière fois), si elle est dans la liste. */
export function preferPeriod(periods: pawnote.Period[], preferred: string | undefined): pawnote.Period[] {
  const found = periods.find((p) => p.name === preferred);
  return found ? [found, ...periods.filter((p) => p !== found)] : periods;
}

/** Notes de la première période qui en a, et les noms des périodes lues ; null s'il n'y a aucune période à lire. */
export async function gradesFromPeriods(
  periods: pawnote.Period[],
  fetchPeriod: (period: pawnote.Period) => Promise<SchoolGrade[]>,
): Promise<{ items: SchoolGrade[]; periods: string[] } | null> {
  if (periods.length === 0) return null;
  const read: string[] = [];
  for (const period of periods) {
    read.push(period.name);
    const items = await fetchPeriod(period);
    if (items.length > 0) return { items, periods: read };
  }
  return { items: [], periods: read };
}

/** Pawnote attend un `fetcher` : celui par défaut n'a pas de délai maximal. */
export const pawnoteFetcher: Parameters<typeof pawnote.createSessionHandle>[0] = async (req) => {
  const res = await fetch(req.url.href, {
    method: req.method ?? 'GET',
    headers: req.headers ?? {},
    body: req.content,
    redirect: req.redirect ?? 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: res.status, content: await res.text(), headers: res.headers };
};

export function createPawnoteClient(): PronoteClient {
  return {
    async login(state) {
      const session = pawnote.createSessionHandle(pawnoteFetcher);
      let refresh: pawnote.RefreshInformation;
      try {
        refresh = await pawnote.loginToken(session, { ...state, kind: state.kind as pawnote.AccountKind });
      } catch (err) {
        if (err instanceof pawnote.BadCredentialsError) throw new Error(`jeton refusé par Pronote : ${PAIRING_HINT}`);
        throw err;
      }
      const resources = session.user.resources;
      const useChild = (child: string) => {
        const resource = resources.find((r) => r.name === child);
        if (!resource) throw new Error('enfant inconnu');
        pawnote.use(session, resource);
        return resource;
      };
      return {
        state: { ...refresh, kind: refresh.kind, deviceUUID: state.deviceUUID },
        children: resources.map((r) => r.name),
        async grades(child, now, preferred) {
          const periods = preferPeriod(gradePeriods(useChild(child).tabs.get(pawnote.TabLocation.Grades), now), preferred);
          return gradesFromPeriods(periods, async (period) => {
            const { grades } = await pawnote.gradesOverview(session, period);
            return grades
              .map(toGrade)
              .filter((g) => g !== null)
              .sort((a, b) => b.date.localeCompare(a.date));
          });
        },
        async attendance(child, now) {
          const period = periodFor(useChild(child).tabs.get(pawnote.TabLocation.Notebook), now);
          if (!period) return null;
          const notebook = await pawnote.notebook(session, period);
          return [...notebook.absences.map(toAbsence), ...notebook.delays.map(toDelay)].sort((a, b) => b.date.localeCompare(a.date));
        },
        async messages() {
          if (!session.user.authorizations.canReadDiscussions) return null;
          const { items } = await pawnote.discussions(session);
          return items
            .map(toMessage)
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, MESSAGES_LIMIT);
        },
        async homework(child, from, to) {
          useChild(child);
          return (await pawnote.assignmentsFromIntervals(session, from, to)).map(toHomework);
        },
        async timetable(child, from, to) {
          useChild(child);
          const timetable = await pawnote.timetableFromIntervals(session, from, to);
          pawnote.parseTimetable(session, timetable, {
            withSuperposedCanceledClasses: false,
            withCanceledClasses: true,
            withPlannedClasses: true,
          });
          return timetable.classes
            .map(toCourse)
            .filter((c) => c !== null)
            .sort((a, b) => a.start.localeCompare(b.start));
        },
      };
    },
  };
}

/** Vrai si Pronote limite les requêtes ou a suspendu l'adresse IP. */
export function isRateLimited(err: unknown): boolean {
  return err instanceof pawnote.RateLimitedError || err instanceof pawnote.SuspendedIPError;
}

/** Délai avant de retenter après `failures` échecs à la suite. */
export function pronoteRetryDelay(failures: number, err: unknown): number {
  if (isRateLimited(err)) return RATE_LIMIT_PAUSE_MS;
  return Math.min(RETRY_FIRST_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
}

/**
 * Âge au-delà duquel les données sont rechargées : `refreshMinutes` en semaine, trois fois plus le week-end ; la
 * nuit, seulement quand elles ne sont plus utilisables (STALE_MAX_MS).
 */
export function pronoteMaxAgeMs(now: Date, refreshMinutes: number): number {
  const hour = now.getHours();
  if (hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR) return STALE_MAX_MS;
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  return refreshMinutes * 60_000 * (weekend ? WEEKEND_FACTOR : 1);
}

type SchoolData = { courses: SchoolCourse[]; homework: Homework[] | null; life: SchoolLifeData };
/** Résultat d'un cycle : par prénom, les données de l'enfant ou l'erreur qui le concerne seul. */
type WeekData = Record<string, SchoolData | { error: string }>;
/** Vie scolaire d'un enfant relue au dernier passage, et la période où ses notes ont été trouvées. */
type ChildLife = { grades: SchoolGrade[] | null; attendance: SchoolAttendance[] | null; at: number; gradePeriod?: string };
type ChildData = { courses: SchoolCourse[]; homework: Homework[] | null; life: ChildLife };

export type PronoteSourceDeps = {
  /** Prénom de l'enfant pour un profil, ou undefined si le profil n'a pas d'emploi du temps Pronote. */
  childFor: (ownerId: string) => string | undefined;
  /** Prénoms de tous les enfants suivis sur Pronote : chargés ensemble, en une seule connexion. */
  children: () => string[];
  refreshMinutes: () => number;
  store: PronoteStateStore;
  client: PronoteClient;
  clock: Clock;
  logger: Logger;
  /** Résultat de chaque chargement, pour la page « Le NAS ». */
  status?: SourceStatus;
};

export function createPronoteSource({ childFor, children, refreshMinutes, store, client, clock, logger, status }: PronoteSourceDeps): SchoolSource {
  // Le jeton change à chaque connexion : deux connexions en parallèle avec le même jeton en invalideraient une.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  async function login(): Promise<PronoteSession> {
    const state = await store.load();
    if (!state) throw new Error(`pas de jeton : ${PAIRING_HINT}`);
    const session = await client.login(state);
    try {
      await store.save(session.state);
    } catch (err) {
      throw new Error(`nouveau jeton impossible à enregistrer (${(err as Error).message}) : ${PAIRING_HINT}`);
    }
    return session;
  }

  const gradeSummaries = new Map<string, string>();
  const lives = new Map<string, ChildLife>();
  let accountMessages: { items: SchoolMessage[] | null; at: number } | undefined;
  /** Dernières données réussies de chaque enfant, avec leur semaine : servies si un cycle échoue pour lui seul. */
  const lastGood = new Map<string, { from: string; data: SchoolData }>();

  /** Une rubrique qui peut être fermée au compte : son échec ne masque qu'elle, sauf une limitation de Pronote. */
  async function part<T>(label: string, task: () => Promise<T | null>, previous: T | null): Promise<T | null> {
    try {
      return await task();
    } catch (err) {
      if (isRateLimited(err)) throw err;
      logger.error(`Pronote : ${label} indisponibles : ${(err as Error).message}.`);
      return previous;
    }
  }

  /** Emploi du temps et devoirs d'un enfant à chaque cycle ; notes et carnet seulement quand `lifeDue`. */
  async function loadChild(session: PronoteSession, prenom: string, start: Date, end: Date, lifeDue: boolean): Promise<ChildData> {
    const child = session.children.find((name) => matchesChild(name, prenom));
    if (!child) throw new Error(`enfant « ${prenom} » introuvable sur le compte Pronote (${session.children.length} enfant(s))`);
    const courses = await session.timetable(child, start, end);
    const homework = await part(`devoirs de ${prenom}`, async () => sortHomework(await session.homework(child, start, end)), null);
    let life = lives.get(prenom);
    if (!life || lifeDue) {
      const now = clock();
      const read = await part(`notes de ${prenom}`, () => session.grades(child, now, life?.gradePeriod), null);
      // Diagnostic discret : nombre de notes reçues et périodes lues (sans le contenu des notes), noté quand il change.
      const summary = read
        ? `${read.items.length} note(s) de ${prenom} (${read.periods.length > 1 ? 'périodes lues' : 'période'} : ${read.periods.map((p) => `« ${p} »`).join(', ')})`
        : `pas d’onglet Notes pour ${prenom}`;
      if (gradeSummaries.get(prenom) !== summary) {
        gradeSummaries.set(prenom, summary);
        logger.log(`Pronote : ${summary}.`);
      }
      const attendance = await part(`absences et retards de ${prenom}`, () => session.attendance(child, now), life?.attendance ?? null);
      life = {
        grades: read ? read.items : (life?.grades ?? null),
        attendance,
        at: now.getTime(),
        // Période où les notes ont été trouvées (la dernière lue) : lue en premier la prochaine fois.
        gradePeriod: read?.items.length ? read.periods.at(-1) : life?.gradePeriod,
      };
      lives.set(prenom, life);
    }
    return { courses, homework, life };
  }

  // Clé : début de la fenêtre (lundi de la semaine en cours) et enfants suivis, pour recharger au changement de
  // semaine ou de configuration. Une seule connexion par cycle pour tous les enfants (le jeton change à chacune).
  const cache = createRefreshingCache<WeekData>({
    clock,
    logger,
    status,
    staleMaxMs: STALE_MAX_MS,
    retryDelay: pronoteRetryDelay,
    // Toutes les clés interrogent le même compte : un échec suspend aussi la semaine suivante.
    retryScope: 'cache',
    load: (key) =>
      exclusive(async () => {
        const { from, children: prenoms } = JSON.parse(key) as { from: string; children: string[] };
        const session = await login();
        const start = new Date(from);
        const end = new Date(start.getTime() + SCHOOL_WINDOW_DAYS * 86_400_000);
        const now = clock().getTime();
        const lifeMs = Math.max(LIFE_REFRESH_MS, refreshMinutes() * 60_000);
        const due = (at: number | undefined) => at === undefined || now - at >= lifeMs;

        const loaded = new Map<string, ChildData | { error: unknown }>();
        for (const prenom of prenoms) {
          try {
            loaded.set(prenom, await loadChild(session, prenom, start, end, due(lives.get(prenom)?.at)));
          } catch (err) {
            if (isRateLimited(err)) throw err;
            loaded.set(prenom, { error: err });
          }
        }
        // Tous en échec : c'est le cycle qui échoue (recul, dernières données conservées par le cache).
        const failed = [...loaded.values()].filter((r) => 'error' in r);
        if (failed.length > 0 && failed.length === prenoms.length) throw failed[0].error;

        // Messagerie : celle du compte, la même pour tous les enfants, lue une seule fois.
        if (due(accountMessages?.at)) {
          const items = await part('messages du compte', () => session.messages(), accountMessages?.items ?? null);
          accountMessages = { items, at: now };
        }
        const messages = accountMessages?.items ?? null;

        const week: WeekData = {};
        for (const [prenom, result] of loaded) {
          if ('error' in result) {
            const previous = lastGood.get(prenom);
            const kept = previous?.from === from;
            logger.error(`Pronote : ${(result.error as Error).message}${kept ? ' ; données précédentes conservées' : ''}.`);
            week[prenom] = kept ? previous.data : { error: (result.error as Error).message };
            continue;
          }
          const life: SchoolLifeData = {
            grades: result.life.grades,
            attendance: result.life.attendance,
            messages: messages && { service: 'Pronote', items: messages },
          };
          const data = { courses: result.courses, homework: result.homework, life };
          lastGood.set(prenom, { from, data });
          week[prenom] = data;
        }
        return week;
      }),
  });
  let warnedNotPaired = false;

  /** Données de la semaine pour ce profil ; null s'il n'est pas sur Pronote ou si l'appairage manque. */
  async function dataFor(ownerId: string): Promise<SchoolData | null> {
    const prenom = childFor(ownerId);
    if (!prenom) return null;
    if (!(await store.load())) {
      if (!warnedNotPaired) logger.error(`Pronote : pas de jeton, ${PAIRING_HINT}.`);
      warnedNotPaired = true;
      return null;
    }
    const now = clock();
    const prenoms = [...new Set([...children(), prenom])].sort();
    const key = JSON.stringify({ from: startOfWeek(now).toISOString(), children: prenoms });
    const data = (await cache.get(key, pronoteMaxAgeMs(now, refreshMinutes()), 'Pronote'))[prenom];
    if (!data) return null;
    if ('error' in data) throw new Error(data.error);
    return data;
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
