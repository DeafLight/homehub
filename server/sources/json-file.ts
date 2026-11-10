// Fichier JSON du dossier d'état (listes, stock, téléphones, visages…) : lu une fois et validé par son schéma zod,
// puis modifié une écriture à la fois. Chaque modification s'applique à une copie, écrite sur le disque (fichier
// temporaire puis renommage, lisible du seul propriétaire) avant de remplacer la valeur en mémoire : une écriture qui
// échoue ne laisse pas la mémoire en avance sur le disque. Un fichier qu'on ne comprend pas n'est jamais écrasé :
// sa lecture lève une erreur (500), et le magasin reste en lecture seule.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';

export type JsonFile<T> = {
  /** Valeur courante, après les écritures en cours ; absente du disque : la valeur initiale. */
  read(): Promise<T>;
  /** Valeur en mémoire, sans attendre (magasins lus au démarrage) ; avant la première lecture : la valeur initiale. */
  current(): T;
  /**
   * Modifie une copie de la valeur puis l'enregistre, une modification à la fois (chacune voit l'état laissé par la
   * précédente). `keep` : faut-il enregistrer, d'après le résultat (refus métier : rien n'est écrit).
   */
  update<R>(apply: (draft: T) => R, keep?: (result: R) => boolean): Promise<R>;
  /** Remplace la valeur entière. */
  replace(next: T): Promise<void>;
};

export type JsonFileOptions<T> = {
  path: string;
  schema: z.ZodType<T>;
  /** Valeur tant que le fichier n'existe pas. */
  initial: () => T;
  /** Juste avant chaque écriture, sur la copie (ménage : vieux mouvements, tâches faites…). */
  beforeSave?: (draft: T) => void;
  /** Fichier indenté (lisible à la main). */
  pretty?: boolean;
  /** Relire le disque à chaque lecture (fichier modifié par un script, comme les PIN). */
  rereadEachTime?: boolean;
};

export function createJsonFile<T>({ path, schema, initial, beforeSave, pretty = false, rereadEachTime = false }: JsonFileOptions<T>): JsonFile<T> {
  let value: T | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<T> {
    if (value !== undefined && !rereadEachTime) return value;
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return (value = initial());
    }
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`${path} illisible :\n${z.prettifyError(parsed.error)}`);
    return (value = parsed.data);
  }

  async function save(next: T) {
    beforeSave?.(next);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, pretty ? JSON.stringify(next, null, 2) : JSON.stringify(next), { mode: 0o600 });
    await rename(tmp, path);
    value = next;
  }

  /** Les écritures passent une par une ; un échec ne bloque pas les suivantes. */
  function enqueue<R>(run: () => Promise<R>): Promise<R> {
    const result = queue.then(run);
    queue = result.catch(() => undefined);
    return result;
  }

  return {
    async read() {
      await queue;
      return load();
    },

    current: () => value ?? initial(),

    update(apply, keep = () => true) {
      return enqueue(async () => {
        const draft = structuredClone(await load());
        const result = apply(draft);
        if (keep(result)) await save(draft);
        return result;
      });
    },

    replace(next) {
      return enqueue(() => save(next));
    },
  };
}
