// Programme de renforcement d'un profil (onglet Sport du téléphone) : règles pures, partagées entre le serveur (qui
// valide et enregistre) et le téléphone (qui affiche et propose). Rien n'est appliqué sans l'accord de la personne :
// le rythme se propose en fin de semaine, les changements d'exercice après deux séances notées pareil.
//
// Trois séances qui tournent (1, 2, 3, puis 1…), sans jour fixe : la suivante est celle d'après la dernière faite.
// Trois paliers (Base 3 tours, Volume 4, Intensité 4). Le rythme : secondes d'effort et de repos de chaque exercice.
import { CHAINS, exerciseById, type Exercise, FAMILIES, type FitnessFamily, GENTLE } from './fitness-catalogue.ts';

export type Palier = 1 | 2 | 3;
export type SessionNumber = 1 | 2 | 3;
export type Rating = 'facile' | 'ok' | 'dur';
export const PAIN_SPOTS = ['genoux', 'epaules', 'dos', 'poignets', 'autre'] as const;
export type PainSpot = (typeof PAIN_SPOTS)[number];
export const PAIN_LABELS: Record<PainSpot, string> = {
  genoux: 'Genoux',
  epaules: 'Épaules',
  dos: 'Dos',
  poignets: 'Poignets',
  autre: 'Autre',
};
export const RATING_LABELS: Record<Rating, string> = { facile: 'Facile', ok: 'Ça va', dur: 'Dur' };
/** Ressenti global d'une séance, de 1 à 5. */
export const RPE_LABELS = ['', 'Facile', 'Confortable', 'Exigeant', 'Dur', 'Trop dur'] as const;

export const PALIERS: Record<Palier, { name: string; rounds: number }> = {
  1: { name: 'Base', rounds: 3 },
  2: { name: 'Volume', rounds: 4 },
  3: { name: 'Intensité', rounds: 4 },
};

export const EFFORT_MIN = 20;
export const EFFORT_MAX = 60;
export const REST_MIN = 10;
export const REST_MAX = 40;
export const STEP = 5;
/** Une bonne semaine à partir de cet effort : palier suivant, avec 10 s d'effort en moins. */
export const NEXT_PALIER_EFFORT = 45;
export const NEXT_PALIER_DROP = 10;
/** Pause entre deux tours, et échauffement avant la séance (comptés à part). */
export const ROUND_BREAK_SECONDS = 60;
export const WARMUP_MINUTES = 5;
export const NOTE_MAX = 300;

export type Rhythm = { palier: Palier; effort: number; rest: number };
export const START_RHYTHM: Rhythm = { palier: 1, effort: 30, rest: 30 };

/** Réglage d'un exercice d'une séance : décalage dans la chaîne (−1 : plus facile), ou remplaçant doux. */
export type SlotSetting = { offset: number; swap: string | null; since: string | null };

export type SessionEntry = {
  family: FitnessFamily;
  exercise: string;
  rating: Rating | null;
  pain: PainSpot | null;
  /** Répétitions (ou secondes tenues) en moyenne par tour. */
  reps: number | null;
  note: string | null;
};

export type FitnessSession = Rhythm & {
  id: string;
  at: string;
  session: SessionNumber;
  rounds: number;
  rpe: number;
  stopped: boolean;
  exercises: SessionEntry[];
  note: string | null;
};

export type WeekLog = { cardio: number | null; waist: number | null };

export type RhythmOption = 'keep' | 'up-same' | 'up-longer' | 'down-same' | 'down-shorter' | 'next-palier';

export type FitnessState = Rhythm & {
  slots: Record<string, SlotSetting>;
  sessions: FitnessSession[];
  weeks: Record<string, WeekLog>;
  /** Bilans tranchés : semaine (lundi) → choix fait et rythme d'avant. */
  reviews: Record<string, { at: string; choice: RhythmOption; from: Rhythm }>;
};

export const emptyFitness = (): FitnessState => ({ ...START_RHYTHM, slots: {}, sessions: [], weeks: {}, reviews: {} });

export const slotKey = (session: SessionNumber, family: FitnessFamily) => `${session}-${family}`;
const NO_SLOT: SlotSetting = { offset: 0, swap: null, since: null };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Lundi (date locale, AAAA-MM-JJ) de la semaine de `date`. */
export function weekOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}

/** Durée d'une séance, sans l'échauffement, en secondes. */
export const sessionSeconds = ({ palier, effort, rest }: Rhythm) => {
  const { rounds } = PALIERS[palier];
  return rounds * FAMILIES.length * (effort + rest) + (rounds - 1) * ROUND_BREAK_SECONDS;
};

export const nextSession = (state: FitnessState): SessionNumber => {
  const last = state.sessions.at(-1);
  return last ? (((last.session % 3) + 1) as SessionNumber) : 1;
};

/** Index dans la chaîne : la version du palier, décalée. */
const chainIndex = (palier: Palier, offset: number) => clamp(palier - 1 + offset, 0, 2);

export type PlannedExercise = {
  family: FitnessFamily;
  exercise: Exercise;
  /** Version normale de ce palier, si on est sur un autre exercice (plus facile, plus difficile, doux). */
  normal: Exercise | null;
};

/** Les six exercices d'une séance, selon le palier et les réglages acceptés. */
export function planSession(state: FitnessState, session: SessionNumber): PlannedExercise[] {
  return FAMILIES.map((family) => {
    const slot = state.slots[slotKey(session, family)] ?? NO_SLOT;
    const chain = CHAINS[session][family];
    const normalId = chain[state.palier - 1];
    const id = slot.swap ?? chain[chainIndex(state.palier, slot.offset)];
    const exercise = exerciseById(id) ?? exerciseById(normalId)!;
    return { family, exercise, normal: exercise.id === normalId ? null : exerciseById(normalId)! };
  });
}

// --- Bilan de la semaine.

export type WeekVerdict = 'up' | 'down' | 'keep';

/** 3 séances sans ressenti 4 ou 5 : on monte ; 2 séances à 5, ou une séance arrêtée : on descend ; sinon on garde. */
export function weekVerdict(sessions: FitnessSession[]): WeekVerdict {
  if (sessions.some((s) => s.stopped) || sessions.filter((s) => s.rpe >= 5).length >= 2) return 'down';
  if (sessions.length >= 3 && sessions.every((s) => s.rpe <= 3)) return 'up';
  return 'keep';
}

export type RhythmChoice = { option: RhythmOption; rhythm: Rhythm; seconds: number };

/** Les rythmes possibles pour un verdict, le recommandé en premier, « garder » en dernier. */
export function rhythmChoices(current: Rhythm, verdict: WeekVerdict): RhythmChoice[] {
  const out: RhythmChoice[] = [];
  const add = (option: RhythmOption, rhythm: Rhythm) => out.push({ option, rhythm, seconds: sessionSeconds(rhythm) });
  const { palier, effort, rest } = current;
  if (verdict === 'up') {
    if (palier < 3 && effort >= NEXT_PALIER_EFFORT) {
      add('next-palier', { palier: (palier + 1) as Palier, effort: Math.max(EFFORT_MIN, effort - NEXT_PALIER_DROP), rest });
    }
    if (effort + STEP <= EFFORT_MAX) {
      if (rest - STEP >= REST_MIN) add('up-same', { palier, effort: effort + STEP, rest: rest - STEP });
      add('up-longer', { palier, effort: effort + STEP, rest });
    }
  } else if (verdict === 'down' && effort - STEP >= EFFORT_MIN) {
    if (rest + STEP <= REST_MAX) add('down-same', { palier, effort: effort - STEP, rest: rest + STEP });
    add('down-shorter', { palier, effort: effort - STEP, rest });
  }
  add('keep', current);
  return out;
}

export type PendingReview = { week: string; verdict: Exclude<WeekVerdict, 'keep'>; sessions: number; choices: RhythmChoice[] };

/**
 * Bilan à trancher : celui de la dernière semaine où il y a eu des séances, une fois finie (ou dès sa 3e séance), s'il
 * propose de changer le rythme et n'a pas déjà été tranché. Une semaine moyenne garde le rythme sans rien demander.
 */
export function pendingReview(state: FitnessState, now: Date): PendingReview | null {
  const last = state.sessions.at(-1);
  if (!last) return null;
  const week = weekOf(new Date(last.at));
  if (state.reviews[week]) return null;
  const sessions = state.sessions.filter((s) => weekOf(new Date(s.at)) === week);
  if (week === weekOf(now) && sessions.length < 3) return null;
  const verdict = weekVerdict(sessions);
  if (verdict === 'keep') return null;
  return { week, verdict, sessions: sessions.length, choices: rhythmChoices(state, verdict) };
}

// --- Adaptations d'un exercice.

export type SlotChange = 'easier' | 'harder' | 'gentle' | 'normal';
export type SlotProposal = {
  session: SessionNumber;
  family: FitnessFamily;
  change: SlotChange;
  from: Exercise;
  to: Exercise;
  reason: string;
};

/** Notes d'un exercice d'une séance depuis le dernier changement (la plus récente en dernier). */
function entriesSince(state: FitnessState, session: SessionNumber, family: FitnessFamily, exercise: string, since: string | null) {
  return state.sessions
    .filter((s) => s.session === session && (!since || s.at > since))
    .flatMap((s) => s.exercises.filter((e) => e.family === family && e.exercise === exercise));
}

/** Ce que le changement donnerait, ou null s'il n'y a pas d'exercice dans ce sens. */
export function slotTarget(state: FitnessState, session: SessionNumber, family: FitnessFamily, change: SlotChange): Exercise | null {
  const slot = state.slots[slotKey(session, family)] ?? NO_SLOT;
  const chain = CHAINS[session][family];
  const index = chainIndex(state.palier, slot.offset);
  const currentId = slot.swap ?? chain[index];
  if (change === 'normal') return slot.swap || slot.offset ? exerciseById(chain[state.palier - 1])! : null;
  if (change === 'gentle') {
    const id = GENTLE[family].find((g) => g !== currentId);
    return id ? exerciseById(id)! : null;
  }
  if (slot.swap) return null;
  const next = index + (change === 'easier' ? -1 : 1);
  return next < 0 || next > 2 ? null : exerciseById(chain[next])!;
}

/** Réglage après un changement accepté. */
export function applySlotChange(state: FitnessState, session: SessionNumber, family: FitnessFamily, change: SlotChange, at: string): SlotSetting {
  const slot = state.slots[slotKey(session, family)] ?? NO_SLOT;
  const index = chainIndex(state.palier, slot.offset);
  if (change === 'normal') return { offset: 0, swap: null, since: at };
  if (change === 'gentle') return { ...slot, swap: slotTarget(state, session, family, 'gentle')?.id ?? slot.swap, since: at };
  // Décalage relatif au palier : il suit la personne quand le palier change.
  return { offset: index + (change === 'easier' ? -1 : 1) - (state.palier - 1), swap: null, since: at };
}

/**
 * Propositions : une gêne à la dernière séance → remplaçant doux ; « dur » deux fois de suite → plus facile ;
 * « facile » deux fois → plus difficile (ou, sur un remplaçant doux, retour à l'exercice normal).
 */
export function slotProposals(state: FitnessState): SlotProposal[] {
  const out: SlotProposal[] = [];
  for (const session of [1, 2, 3] as SessionNumber[]) {
    for (const { family, exercise } of planSession(state, session)) {
      const slot = state.slots[slotKey(session, family)] ?? NO_SLOT;
      const entries = entriesSince(state, session, family, exercise.id, slot.since);
      const last = entries.at(-1);
      const lastTwo = entries.slice(-2);
      const twice = (rating: Rating) => lastTwo.length === 2 && lastTwo.every((e) => e.rating === rating);
      let change: SlotChange | null = null;
      let reason = '';
      if (last?.pain) {
        change = 'gentle';
        reason = `gêne (${PAIN_LABELS[last.pain].toLowerCase()}) à la dernière séance`;
      } else if (twice('dur')) {
        change = 'easier';
        reason = 'noté « dur » deux fois de suite';
      } else if (twice('facile')) {
        change = slot.swap ? 'normal' : 'harder';
        reason = 'noté « facile » deux fois de suite';
      }
      const to = change && slotTarget(state, session, family, change);
      if (change && to) out.push({ session, family, change, from: exercise, to, reason });
    }
  }
  return out;
}

/** Message du palier : où l'on en est, et ce qui fait passer au suivant. */
export function palierHint({ palier, effort }: Rhythm): string {
  if (palier === 3) return 'Dernier palier : le rythme continue d’augmenter tant que les semaines se passent bien.';
  if (effort >= NEXT_PALIER_EFFORT) return `Une bonne semaine à ce rythme et tu passes au palier ${palier + 1}.`;
  return `Palier ${palier + 1} : après une bonne semaine à ${NEXT_PALIER_EFFORT} s d’effort.`;
}

export const OPTION_LABELS: Record<RhythmOption, string> = {
  keep: 'Garder ce rythme',
  'up-same': '+5 s d’effort, même durée',
  'up-longer': '+5 s d’effort, séance plus longue',
  'down-same': '−5 s d’effort, même durée',
  'down-shorter': '−5 s d’effort, séance plus courte',
  'next-palier': 'Palier suivant',
};
