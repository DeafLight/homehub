// Visages de la famille, pour que la tablette sache qui écrit. La tablette calcule elle-même, à partir de la caméra,
// une empreinte numérique du visage (aucune image ne quitte la tablette) ; seules ces empreintes sont enregistrées
// ici (faces.json, dossier d'état), et la comparaison se fait sur le serveur. Une identification réussie ouvre une
// session courte, présentée ensuite par la tablette avec chaque modification.
import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Clock } from './types.ts';

/** Empreintes enregistrées par personne, au plus (les plus récentes). */
export const MAX_SAMPLES = 10;

export const embeddingSchema = z.array(z.number()).min(64).max(2048);
const fileSchema = z.object({
  version: z.literal(1),
  faces: z.record(z.string(), z.array(embeddingSchema)),
});

type FacesFile = z.infer<typeof fileSchema>;

export type FaceMatch = { ownerId: string; score: number; next: number };

export type FaceStore = {
  enrolled(): Promise<string[]>;
  /** Ajoute des empreintes à celles de `ownerId` (gardées : les MAX_SAMPLES plus récentes). */
  enroll(ownerId: string, embeddings: number[][]): Promise<void>;
  remove(ownerId: string): Promise<boolean>;
  /** Personne la plus ressemblante, son score (0 à 1) et celui de la suivante ; null si personne n'est enregistré. */
  closest(embedding: number[]): Promise<FaceMatch | null>;
};

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
      return (data = { version: 1, faces: {} });
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

    enroll(ownerId, embeddings) {
      return change((file) => {
        file.faces[ownerId] = [...(file.faces[ownerId] ?? []), ...embeddings].slice(-MAX_SAMPLES);
      });
    },

    remove(ownerId) {
      return change((file) => {
        if (!(ownerId in file.faces)) return false;
        delete file.faces[ownerId];
        return true;
      });
    },

    async closest(embedding) {
      const scores = Object.entries((await load()).faces)
        .map(([ownerId, samples]) => ({ ownerId, score: Math.max(...samples.map((s) => similarity(embedding, s))) }))
        .sort((a, b) => b.score - a.score);
      if (scores.length === 0) return null;
      return { ownerId: scores[0].ownerId, score: scores[0].score, next: scores[1]?.score ?? 0 };
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
