// Programme de renforcement de chaque profil qui en a un (`fitness: true` dans homehub.yaml) : rythme, réglages des
// exercices, séances notées, cardio et tour de taille de chaque semaine. Données personnelles, dans le dossier d'état
// (fitness.json, donc dans la sauvegarde), lues et écrites seulement par le téléphone de la personne.
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { FAMILIES, type FitnessFamily } from '../../shared/fitness-catalogue.ts';
import {
  applySlotChange,
  emptyFitness,
  type FitnessState,
  NOTE_MAX,
  PAIN_SPOTS,
  PALIERS,
  pendingReview,
  planSession,
  type RhythmOption,
  type SessionNumber,
  type SlotChange,
  slotKey,
  slotTarget,
  weekOf,
} from '../../shared/fitness.ts';
import type { Clock } from './types.ts';

const MAX_SESSIONS = 2000;

const note = z
  .string()
  .trim()
  .max(NOTE_MAX)
  .nullish()
  .transform((v) => (v ? v : null));
const family = z.enum(FAMILIES as [FitnessFamily, ...FitnessFamily[]]);
const sessionNumber = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const rating = z.enum(['facile', 'ok', 'dur']).nullable();
const pain = z.enum(PAIN_SPOTS).nullable();
const reps = z.number().int().min(0).max(999).nullable();
const rhythm = { palier: sessionNumber, effort: z.number().int(), rest: z.number().int() };

/** Ce que le téléphone envoie à la fin d'une séance (les exercices faits se déduisent du programme). */
export const sessionInput = z.object({
  session: sessionNumber,
  rpe: z.number().int().min(1).max(5),
  stopped: z.boolean().default(false),
  note,
  exercises: z
    .array(z.object({ family, rating: rating.default(null), pain: pain.default(null), reps: reps.default(null), note }))
    .max(FAMILIES.length)
    .refine((list) => new Set(list.map((e) => e.family)).size === list.length, 'famille en double'),
});
export type SessionInput = z.infer<typeof sessionInput>;

export const weekInput = z.object({
  cardio: z.number().int().min(0).max(5000).nullable(),
  waist: z.number().min(30).max(250).nullable(),
});
export const rhythmInput = z.object({
  week: z.string(),
  option: z.enum(['keep', 'up-same', 'up-longer', 'down-same', 'down-shorter', 'next-palier']),
});
export const slotInput = z.object({ session: sessionNumber, family, change: z.enum(['easier', 'harder', 'gentle', 'normal', 'dismiss']) });

const stateSchema = z.object({
  ...rhythm,
  slots: z.record(z.string(), z.object({ offset: z.number().int().min(-2).max(2), swap: z.string().nullable(), since: z.string().nullable() })),
  sessions: z.array(
    z.object({
      ...rhythm,
      id: z.string(),
      at: z.string(),
      session: sessionNumber,
      rounds: z.number().int(),
      rpe: z.number().int().min(1).max(5),
      stopped: z.boolean(),
      exercises: z.array(z.object({ family, exercise: z.string(), rating, pain, reps, note: z.string().nullable() })),
      note: z.string().nullable(),
    }),
  ),
  weeks: z.record(z.string(), z.object({ cardio: z.number().nullable(), waist: z.number().nullable() })),
  reviews: z.record(
    z.string(),
    z.object({ at: z.string(), choice: rhythmInput.shape.option, from: z.object(rhythm) }),
  ),
});
const fileSchema = z.object({ version: z.literal(1), members: z.record(z.string(), stateSchema) });

export type FitnessResult = { state: FitnessState } | { error: string; status: 400 | 404 | 409 };

export type FitnessStore = {
  load(): Promise<void>;
  /** Programme du profil (vide s'il n'a encore rien noté). */
  get(ownerId: string): FitnessState;
  addSession(ownerId: string, input: SessionInput): Promise<FitnessState>;
  removeSession(ownerId: string, id: string): Promise<FitnessResult>;
  setWeek(ownerId: string, week: string, log: z.infer<typeof weekInput>): Promise<FitnessResult>;
  chooseRhythm(ownerId: string, week: string, option: RhythmOption): Promise<FitnessResult>;
  changeSlot(ownerId: string, session: SessionNumber, family: FitnessFamily, change: SlotChange | 'dismiss'): Promise<FitnessResult>;
};

export function createFitnessStore({ path, clock }: { path: string; clock: Clock }): FitnessStore {
  let members: Record<string, FitnessState> = {};
  let queue: Promise<unknown> = Promise.resolve();

  const get = (ownerId: string) => members[ownerId] ?? emptyFitness();

  /** Modifie le programme d'un profil puis enregistre le fichier, une écriture à la fois. */
  function update(ownerId: string, change: (state: FitnessState) => FitnessResult): Promise<FitnessResult> {
    const run = queue.then(async () => {
      const draft = structuredClone(get(ownerId));
      const result = change(draft);
      if ('error' in result) return result;
      const next = { ...members, [ownerId]: result.state };
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify({ version: 1, members: next }, null, 2), { mode: 0o600 });
      await rename(tmp, path);
      members = next;
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    async load() {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        return;
      }
      const parsed = fileSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error(`${path} illisible :\n${z.prettifyError(parsed.error)}`);
      members = parsed.data.members as Record<string, FitnessState>;
    },

    get,

    async addSession(ownerId, input) {
      const result = await update(ownerId, (state) => {
        const plan = planSession(state, input.session);
        const notes = new Map(input.exercises.map((e) => [e.family, e]));
        state.sessions.push({
          id: randomUUID(),
          at: clock().toISOString(),
          session: input.session,
          palier: state.palier,
          effort: state.effort,
          rest: state.rest,
          rounds: PALIERS[state.palier].rounds,
          rpe: input.rpe,
          stopped: input.stopped,
          note: input.note,
          exercises: plan.map(({ family, exercise }) => {
            const e = notes.get(family);
            return { family, exercise: exercise.id, rating: e?.rating ?? null, pain: e?.pain ?? null, reps: e?.reps ?? null, note: e?.note ?? null };
          }),
        });
        state.sessions = state.sessions.slice(-MAX_SESSIONS);
        return { state };
      });
      return (result as { state: FitnessState }).state;
    },

    removeSession: (ownerId, id) =>
      update(ownerId, (state) => {
        if (!state.sessions.some((s) => s.id === id)) return { error: 'Séance inconnue', status: 404 };
        state.sessions = state.sessions.filter((s) => s.id !== id);
        return { state };
      }),

    setWeek: (ownerId, week, log) =>
      update(ownerId, (state) => {
        const monday = /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(`${week}T12:00:00`) : null;
        if (!monday || Number.isNaN(monday.getTime()) || weekOf(monday) !== week) return { error: 'Semaine attendue : date d’un lundi', status: 400 };
        if (log.cardio === null && log.waist === null) delete state.weeks[week];
        else state.weeks[week] = log;
        return { state };
      }),

    chooseRhythm: (ownerId, week, option) =>
      update(ownerId, (state) => {
        const review = pendingReview(state, clock());
        if (!review || review.week !== week) return { error: 'Pas de bilan en attente pour cette semaine', status: 409 };
        const choice = review.choices.find((c) => c.option === option);
        if (!choice) return { error: 'Ce rythme n’est pas proposé', status: 400 };
        state.reviews[week] = { at: clock().toISOString(), choice: option, from: { palier: state.palier, effort: state.effort, rest: state.rest } };
        Object.assign(state, choice.rhythm);
        return { state };
      }),

    changeSlot: (ownerId, session, family, change) =>
      update(ownerId, (state) => {
        const key = slotKey(session, family);
        const at = clock().toISOString();
        if (change === 'dismiss') {
          state.slots[key] = { ...(state.slots[key] ?? { offset: 0, swap: null }), since: at };
          return { state };
        }
        if (!slotTarget(state, session, family, change)) return { error: 'Pas d’autre exercice dans ce sens', status: 400 };
        state.slots[key] = applySlotChange(state, session, family, change, at);
        return { state };
      }),
  };
}
