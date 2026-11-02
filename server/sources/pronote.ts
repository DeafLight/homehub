// Emploi du temps Pronote, par Pawnote (bibliothèque non officielle qui imite l'application mobile ; corrigée pour
// Pronote 2026 par scripts/patch-pawnote.ts). Connexion par jeton, comme l'application : le jeton de départ vient
// du QR code de Pronote (scripts/pronote-pair.ts), et Pronote en donne un nouveau à chaque connexion. Il est donc
// réenregistré aussitôt dans un fichier : l'ancien ne sert plus, le perdre oblige à refaire l'appairage.
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import * as pawnote from 'pawnote';
import { z } from 'zod';
import type { SchoolCourse } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import { formatSubject, normalizeName } from './ecoledirecte.ts';
import { createRefreshingCache } from './refreshing-cache.ts';
import type { Clock, SchoolSource, TimeRange } from './types.ts';

const REQUEST_TIMEOUT_MS = 15_000;
/** En cas de panne, l'emploi du temps reste affiché tant qu'il a moins de 24 h. */
const STALE_MAX_MS = 24 * 3_600_000;
/** Jours chargés à partir d'aujourd'hui. */
const WINDOW_DAYS = 8;
const PAIRING_HINT = 'refaire l’appairage (scripts/pronote-pair.ts, voir README)';

/** Ce qu'il faut pour se reconnecter : le format de RefreshInformation de Pawnote, plus l'appareil. */
export const pronoteStateSchema = z.object({
  url: z.string().url(),
  kind: z.number(),
  username: z.string().min(1),
  token: z.string().min(1),
  deviceUUID: z.string().min(1),
  navigatorIdentifier: z.string(),
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
      return {
        state: { ...refresh, kind: refresh.kind, deviceUUID: state.deviceUUID },
        children: resources.map((r) => r.name),
        async timetable(child, from, to) {
          const resource = resources.find((r) => r.name === child);
          if (!resource) throw new Error('enfant inconnu');
          pawnote.use(session, resource);
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

export type PronoteSourceDeps = {
  /** Prénom de l'enfant pour un profil, ou undefined si le profil n'a pas d'emploi du temps Pronote. */
  childFor: (ownerId: string) => string | undefined;
  refreshMinutes: () => number;
  store: PronoteStateStore;
  client: PronoteClient;
  clock: Clock;
  logger: Logger;
};

export function createPronoteSource({ childFor, refreshMinutes, store, client, clock, logger }: PronoteSourceDeps): SchoolSource {
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

  // Clé : enfant et jour de début de la fenêtre, pour recharger au changement de jour.
  const cache = createRefreshingCache<SchoolCourse[]>({
    clock,
    logger,
    staleMaxMs: STALE_MAX_MS,
    load: (key) =>
      exclusive(async () => {
        const { prenom, from } = JSON.parse(key) as { prenom: string; from: string };
        const session = await login();
        const child = session.children.find((name) => matchesChild(name, prenom));
        if (!child) throw new Error(`enfant « ${prenom} » introuvable sur le compte Pronote (${session.children.length} enfant(s))`);
        const start = new Date(from);
        return session.timetable(child, start, new Date(start.getTime() + WINDOW_DAYS * 86_400_000));
      }),
  });
  let warnedNotPaired = false;

  return {
    async coursesFor(ownerId, range: TimeRange) {
      const prenom = childFor(ownerId);
      if (!prenom) return null;
      if (!(await store.load())) {
        if (!warnedNotPaired) logger.error(`Pronote : pas de jeton, ${PAIRING_HINT}.`);
        warnedNotPaired = true;
        return null;
      }
      const today = clock();
      today.setHours(0, 0, 0, 0);
      const courses = await cache.get(JSON.stringify({ prenom, from: today.toISOString() }), refreshMinutes() * 60_000, 'Pronote');
      return courses.filter((c) => new Date(c.end) > range.from && new Date(c.start) < range.to);
    },
  };
}
