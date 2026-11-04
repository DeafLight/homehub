// Visages de la famille, pour que la tablette sache qui écrit. La tablette calcule elle-même, à partir de la caméra,
// une empreinte numérique du visage (aucune image ne quitte la tablette) ; seules ces empreintes sont enregistrées
// ici (faces.json, dossier d'état), et la comparaison se fait sur le serveur. Une identification réussie ouvre une
// session courte, présentée ensuite par la tablette avec chaque modification. Aux empreintes enregistrées (guidées,
// avec le code parent) s'ajoutent quelques empreintes apprises en route : prises lors de reconnaissances sûres, elles
// suivent les changements (coiffure, lunettes, lumière) sans jamais remplacer les enregistrées.
import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Clock } from './types.ts';

/** Empreintes enregistrées par personne, au plus (les plus récentes). */
export const MAX_SAMPLES = 20;
/** Empreintes apprises par personne, au plus (les plus récentes). */
export const MAX_LEARNED = 10;

export const embeddingSchema = z.array(z.number()).min(64).max(2048);
const fileSchema = z.object({
  version: z.literal(1),
  faces: z.record(z.string(), z.array(embeddingSchema)),
  learned: z.record(z.string(), z.array(embeddingSchema)).default({}),
});

type FacesFile = z.infer<typeof fileSchema>;

export type FaceScore = { ownerId: string; score: number };
export type FaceCounts = Record<string, { enrolled: number; learned: number }>;

export type FaceStore = {
  enrolled(): Promise<string[]>;
  /** Nombre d'empreintes enregistrées et apprises, par personne. */
  counts(): Promise<FaceCounts>;
  /** Ajoute des empreintes à celles de `ownerId` (gardées : les MAX_SAMPLES plus récentes). */
  enroll(ownerId: string, embeddings: number[][]): Promise<void>;
  /** Ajoute une empreinte apprise (gardées : les MAX_LEARNED plus récentes) ; ignorée si personne n'est enregistré. */
  learn(ownerId: string, embedding: number[]): Promise<void>;
  /** Efface les empreintes de `ownerId`, enregistrées et apprises. */
  remove(ownerId: string): Promise<boolean>;
  /** Ressemblance (0 à 1) avec chaque personne enregistrée, de la plus à la moins ressemblante. */
  scores(embedding: number[]): Promise<FaceScore[]>;
};

export type FaceRules = { threshold: number; margin: number; antispoof: number; liveness: number };

/**
 * Verdict d'une analyse : `ok`, ou la raison du refus (`photo` : score contre une photo trop bas ; `screen` : contre
 * un écran ; `none` : aucun visage enregistré ; `low` : ressemblance sous le seuil ; `close` : trop proche de la
 * personne suivante pour trancher).
 */
export type FaceVerdict = {
  result: 'ok' | 'photo' | 'screen' | 'none' | 'low' | 'close';
  /** Personne la plus ressemblante, et sa ressemblance ; `next` : celle de la suivante. */
  ownerId: string | null;
  score: number;
  next: number;
};

/** Juge une analyse de la tablette ; `scores` : ceux des membres actuels, du plus au moins ressemblant. */
export function judge(reading: { real: number; live: number }, scores: FaceScore[], rules: FaceRules): FaceVerdict {
  const best = scores[0];
  const base = { ownerId: best?.ownerId ?? null, score: best?.score ?? 0, next: scores[1]?.score ?? 0 };
  if (reading.real < rules.antispoof) return { result: 'photo', ...base };
  if (reading.live < rules.liveness) return { result: 'screen', ...base };
  if (!best) return { result: 'none', ...base };
  if (base.score < rules.threshold) return { result: 'low', ...base };
  if (base.score - base.next < rules.margin) return { result: 'close', ...base };
  return { result: 'ok', ...base };
}

/** Au-delà, l'empreinte ressemble déjà trop à une connue pour apprendre quoi que ce soit. */
const LEARN_BELOW = 0.85;
/** Avance sur le seuil, et marge sur la personne suivante (en multiple de celle exigée), pour apprendre. */
const LEARN_ABOVE = 0.05;
const LEARN_MARGIN = 2;

/** Reconnaissance assez sûre, et assez nouvelle, pour apprendre l'empreinte. */
export function worthLearning(verdict: FaceVerdict, rules: FaceRules): boolean {
  return (
    verdict.result === 'ok' &&
    verdict.score >= rules.threshold + LEARN_ABOVE &&
    verdict.score < LEARN_BELOW &&
    verdict.score - verdict.next >= LEARN_MARGIN * rules.margin
  );
}

/**
 * Ressemblance de deux empreintes, de 0 à 1 : celle de la bibliothèque de la tablette (Human, `similarity`),
 * distance euclidienne ramenée à une échelle où 0,5 et plus désigne d'ordinaire la même personne.
 */
export function similarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  const distance = Math.round(100 * 25 * sum) / 100;
  if (distance === 0) return 1;
  const normalized = (1 - Math.sqrt(distance) / 100 - 0.2) / (0.8 - 0.2);
  return Math.round(100 * Math.max(Math.min(normalized, 1), 0)) / 100;
}

export function createFaceStore({ path }: { path: string }): FaceStore {
  let data: FacesFile | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<FacesFile> {
    if (data) return data;
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return (data = { version: 1, faces: {}, learned: {} });
    }
    const parsed = fileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`${path} illisible :\n${z.prettifyError(parsed.error)}`);
    return (data = parsed.data);
  }

  function change<T>(apply: (file: FacesFile) => T): Promise<T> {
    const run = queue.then(async () => {
      const file = await load();
      const result = apply(file);
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
      await rename(tmp, path);
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    async enrolled() {
      return Object.keys((await load()).faces);
    },

    async counts() {
      const file = await load();
      return Object.fromEntries(
        Object.entries(file.faces).map(([ownerId, samples]) => [
          ownerId,
          { enrolled: samples.length, learned: file.learned[ownerId]?.length ?? 0 },
        ]),
      );
    },

    enroll(ownerId, embeddings) {
      return change((file) => {
        file.faces[ownerId] = [...(file.faces[ownerId] ?? []), ...embeddings].slice(-MAX_SAMPLES);
      });
    },

    learn(ownerId, embedding) {
      return change((file) => {
        if (!(ownerId in file.faces)) return;
        file.learned[ownerId] = [...(file.learned[ownerId] ?? []), embedding].slice(-MAX_LEARNED);
      });
    },

    remove(ownerId) {
      return change((file) => {
        if (!(ownerId in file.faces)) return false;
        delete file.faces[ownerId];
        delete file.learned[ownerId];
        return true;
      });
    },

    async scores(embedding) {
      const file = await load();
      return Object.entries(file.faces)
        .map(([ownerId, samples]) => {
          const all = [...samples, ...(file.learned[ownerId] ?? [])];
          return { ownerId, score: Math.max(...all.map((s) => similarity(embedding, s))) };
        })
        .sort((a, b) => b.score - a.score);
    },
  };
}

/** Sessions ouvertes par une identification : jeton → personne. En mémoire seulement (perdues au redémarrage). */
export type ActorSessions = {
  open(ownerId: string, minutes: number): { token: string; expiresAt: string };
  /** Personne identifiée par ce jeton, ou null ; chaque usage prolonge la session. */
  get(token: string | undefined, minutes: number): string | null;
  close(token: string | undefined): void;
};

export function createActorSessions(clock: Clock): ActorSessions {
  const sessions = new Map<string, { ownerId: string; expiresAt: number }>();
  const now = () => clock().getTime();

  return {
    open(ownerId, minutes) {
      for (const [token, session] of sessions) if (session.expiresAt <= now()) sessions.delete(token);
      const token = randomBytes(24).toString('base64url');
      const expiresAt = now() + minutes * 60_000;
      sessions.set(token, { ownerId, expiresAt });
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    },

    get(token, minutes) {
      const session = token ? sessions.get(token) : undefined;
      if (!session || session.expiresAt <= now()) return null;
      session.expiresAt = now() + minutes * 60_000;
      return session.ownerId;
    },

    close(token) {
      if (token) sessions.delete(token);
    },
  };
}
