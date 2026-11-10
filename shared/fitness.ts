// Programme de renforcement d'un profil (onglet Sport du téléphone) : règles pures, partagées entre le serveur (qui
// valide et enregistre) et le téléphone (qui affiche et propose). Rien n'est appliqué sans l'accord de la personne :
// le rythme se propose en fin de semaine, les changements d'exercice après deux séances notées pareil.
//
// Trois séances qui tournent (1, 2, 3, puis 1…), sans jour fixe : la suivante est celle d'après la dernière faite.
// Trois paliers (Base 3 tours, Volume 4, Intensité 4). Le rythme : secondes d'effort et de repos de chaque exercice.
// Un changement de palier se fait en deux temps : la moitié des exercices passe à la version plus difficile tout de
// suite, l'autre moitié au bon bilan suivant. Deux réglages : élastique de tirage, sans sauts.
import { localDay } from './dates.ts';
import { BAND_CHAIN, CHAINS, exerciseById, type Exercise, FAMILIES, FAMILY_LABELS, type FitnessFamily, GENTLE, WITHOUT_JUMPS } from './fitness-catalogue.ts';

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

/** Fin de séance envoyée par le téléphone (POST /api/fitness/sessions) : ressenti global, puis par exercice. */
export type SessionReport = {
  session: SessionNumber;
  rpe: number;
  stopped: boolean;
  note: string | null;
  exercises: { family: FitnessFamily; rating: Rating | null; pain: PainSpot | null; reps: number | null; note: string | null }[];
};

/** Fin d'une séance guidée sur la tablette : seulement le ressenti, rien par exercice. */
export type TabletSessionReport = Pick<SessionReport, 'session' | 'rpe' | 'stopped'>;

export const RHYTHM_OPTIONS = ['keep', 'up-same', 'up-longer', 'down-same', 'down-shorter', 'next-palier', 'complete-palier'] as const;
export type RhythmOption = (typeof RHYTHM_OPTIONS)[number];

/** Réglages du programme, choisis par la personne : matériel et sauts. */
export type FitnessSettings = {
  /** Élastique de tirage fixé à une porte : le dos de chaque séance devient un rowing à l'élastique. */
  band: boolean;
  /** Sans sauts : chaque exercice qui saute est remplacé, dès le départ, par sa version sans impact. */
  noJump: boolean;
};
export const DEFAULT_SETTINGS: FitnessSettings = { band: false, noJump: false };

/**
 * Changement de palier en deux temps : `moved`, les familles qui viennent de passer à la version du palier (depuis
 * `since`) ; `waiting`, celles qui gardent la version du palier d'avant jusqu'au bon bilan suivant.
 */
export type PalierStage = { moved: FitnessFamily[]; waiting: FitnessFamily[]; since: string };
/** Au changement de palier, ces familles passent tout de suite ; les autres (cardio, poussée, une jambe) au bilan suivant. */
export const FIRST_WAVE: readonly FitnessFamily[] = ['jambes', 'dos', 'gainage'];
export const SECOND_WAVE: readonly FitnessFamily[] = FAMILIES.filter((f) => !FIRST_WAVE.includes(f));

export type FitnessState = Rhythm & {
  settings: FitnessSettings;
  stage: PalierStage | null;
  slots: Record<string, SlotSetting>;
  sessions: FitnessSession[];
  weeks: Record<string, WeekLog>;
  /** Bilans tranchés : semaine (lundi) → choix fait et rythme d'avant. */
  reviews: Record<string, { at: string; choice: RhythmOption; from: Rhythm }>;
};

export const emptyFitness = (): FitnessState => ({
  ...START_RHYTHM,
  settings: { ...DEFAULT_SETTINGS },
  stage: null,
  slots: {},
  sessions: [],
  weeks: {},
  reviews: {},
});

export const slotKey = (session: SessionNumber, family: FitnessFamily) => `${session}-${family}`;
const NO_SLOT: SlotSetting = { offset: 0, swap: null, since: null };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Lundi (date locale, AAAA-MM-JJ) de la semaine de `date`. */
export function weekOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(d);
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

/** Chaîne d'une famille selon le matériel seulement (élastique : rowing pour le dos), avant le réglage « sans sauts ». */
const baseChain = (settings: FitnessSettings, session: SessionNumber, family: FitnessFamily): readonly string[] =>
  settings.band && family === 'dos' ? BAND_CHAIN : CHAINS[session][family];

/** Les trois versions d'une famille dans une séance, réglages appliqués (élastique, sans sauts). */
export function chainOf(settings: FitnessSettings, session: SessionNumber, family: FitnessFamily): readonly string[] {
  const chain = baseChain(settings, session, family);
  return settings.noJump ? chain.map((id) => WITHOUT_JUMPS[id] ?? id) : chain;
}

/** Palier de la version d'une famille : celui du programme, ou le précédent pendant un changement en deux temps. */
export const familyPalier = (state: FitnessState, family: FitnessFamily): Palier =>
  (state.stage?.waiting.includes(family) ? Math.max(1, state.palier - 1) : state.palier) as Palier;

/** Index dans la chaîne : la version du palier de la famille, décalée. */
const chainIndex = (state: FitnessState, family: FitnessFamily, offset: number) => clamp(familyPalier(state, family) - 1 + offset, 0, 2);

export type PlannedExercise = {
  family: FitnessFamily;
  exercise: Exercise;
  /** Version normale de ce palier, si on est sur un autre exercice (plus facile, plus difficile, doux, sans saut). */
  normal: Exercise | null;
  /**
   * Changement de palier en deux temps : `new`, passé au nouveau palier et pas encore fait dans cette séance (`before`,
   * la version d'avant) ; `waiting`, garde la version du palier précédent jusqu'au bon bilan suivant.
   */
  stage: 'new' | 'waiting' | null;
  before: Exercise | null;
};

/** Les six exercices d'une séance, selon le palier, les réglages du programme et les changements acceptés. */
export function planSession(state: FitnessState, session: SessionNumber): PlannedExercise[] {
  const { stage } = state;
  return FAMILIES.map((family) => {
    const slot = state.slots[slotKey(session, family)] ?? NO_SLOT;
    const chain = chainOf(state.settings, session, family);
    const index = familyPalier(state, family) - 1;
    const normalId = baseChain(state.settings, session, family)[index];
    const id = slot.swap ?? chain[chainIndex(state, family, slot.offset)];
    const exercise = exerciseById(id) ?? exerciseById(chain[index])!;
    let step: PlannedExercise['stage'] = null;
    let before: Exercise | null = null;
    if (stage?.waiting.includes(family)) step = 'waiting';
    else if (stage?.moved.includes(family) && !slot.swap && !state.sessions.some((s) => s.session === session && s.at > stage.since)) {
      const previous = exerciseById(chain[clamp(index - 1 + slot.offset, 0, 2)]) ?? null;
      if (previous && previous.id !== exercise.id) [step, before] = ['new', previous];
    }
    return { family, exercise, normal: exercise.id === normalId ? null : exerciseById(normalId)!, stage: step, before };
  });
}

// --- Bilan de la semaine.

export type WeekVerdict = 'up' | 'down' | 'keep';

/** Une bonne semaine : au moins ce nombre de séances (comme la série des statistiques), aucune au-delà d'« exigeant ». */
export const GOOD_WEEK_SESSIONS = 2;

/**
 * 2 séances ou plus sans ressenti 4 ou 5 : on monte ; 2 séances à 5, ou une séance arrêtée : on descend ; sinon on
 * garde.
 */
export function weekVerdict(sessions: FitnessSession[]): WeekVerdict {
  if (sessions.some((s) => s.stopped) || sessions.filter((s) => s.rpe >= 5).length >= 2) return 'down';
  if (sessions.length >= GOOD_WEEK_SESSIONS && sessions.every((s) => s.rpe <= 3)) return 'up';
  return 'keep';
}

export type RhythmChoice = { option: RhythmOption; rhythm: Rhythm; seconds: number };

/**
 * Les rythmes possibles pour un verdict, le recommandé en premier, « garder » en dernier. Pendant un changement de
 * palier en deux temps (`waiting`), une bonne semaine propose seulement de finir le palier, au même rythme.
 */
export function rhythmChoices(current: Rhythm, verdict: WeekVerdict, waiting = false): RhythmChoice[] {
  const out: RhythmChoice[] = [];
  const add = (option: RhythmOption, rhythm: Rhythm) => out.push({ option, rhythm, seconds: sessionSeconds(rhythm) });
  const { palier, effort, rest } = current;
  if (verdict === 'up' && waiting) {
    add('complete-palier', { palier, effort, rest });
  } else if (verdict === 'up') {
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
  add('keep', { palier, effort, rest });
  return out;
}

/**
 * Applique un rythme choisi au bilan : le rythme, et le changement de palier en deux temps (palier suivant : la
 * première moitié passe, l'autre attend ; finir le palier : l'autre moitié passe à son tour).
 */
export function applyRhythm(state: FitnessState, choice: RhythmChoice, at: string): void {
  Object.assign(state, choice.rhythm);
  if (choice.option === 'next-palier') state.stage = { moved: [...FIRST_WAVE], waiting: [...SECOND_WAVE], since: at };
  if (choice.option === 'complete-palier') state.stage = { moved: state.stage?.waiting ?? [], waiting: [], since: at };
}

export type PendingReview = { week: string; verdict: Exclude<WeekVerdict, 'keep'>; sessions: number; choices: RhythmChoice[] };

/**
 * Bilan à trancher : celui de la dernière semaine finie où il y a eu des séances, s'il propose de changer le rythme et
 * n'a pas déjà été tranché. Une semaine moyenne garde le rythme sans rien demander.
 *
 * Seulement une fois la semaine finie (le lundi) : deux séances suffisent pour monter, mais une 3e séance dure dans la
 * même semaine doit encore pouvoir compter. Le bilan reste proposé toute la semaine suivante, même après de nouvelles
 * séances ; plus ancien, il ne l'est plus qu'en l'absence de séance depuis.
 */
export function pendingReview(state: FitnessState, now: Date): PendingReview | null {
  const current = weekOf(now);
  const finished = state.sessions.filter((s) => weekOf(new Date(s.at)) < current);
  const last = finished.at(-1);
  if (!last) return null;
  const week = weekOf(new Date(last.at));
  if (state.reviews[week]) return null;
  const previous = weekOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
  if (week !== previous && finished.length < state.sessions.length) return null;
  const sessions = finished.filter((s) => weekOf(new Date(s.at)) === week);
  const verdict = weekVerdict(sessions);
  if (verdict === 'keep') return null;
  return { week, verdict, sessions: sessions.length, choices: rhythmChoices(state, verdict, Boolean(state.stage?.waiting.length)) };
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
  const chain = chainOf(state.settings, session, family);
  const index = chainIndex(state, family, slot.offset);
  const currentId = slot.swap ?? chain[index];
  if (change === 'normal') return slot.swap || slot.offset ? exerciseById(chain[familyPalier(state, family) - 1])! : null;
  if (change === 'gentle') {
    const id = GENTLE[family].find((g) => g !== currentId);
    return id ? exerciseById(id)! : null;
  }
  if (slot.swap) return null;
  const next = index + (change === 'easier' ? -1 : 1);
  // Sans sauts, deux versions voisines peuvent être le même exercice : rien à proposer.
  return next < 0 || next > 2 || chain[next] === currentId ? null : exerciseById(chain[next])!;
}

/** Réglage après un changement accepté. */
export function applySlotChange(state: FitnessState, session: SessionNumber, family: FitnessFamily, change: SlotChange, at: string): SlotSetting {
  const slot = state.slots[slotKey(session, family)] ?? NO_SLOT;
  const index = chainIndex(state, family, slot.offset);
  if (change === 'normal') return { offset: 0, swap: null, since: at };
  if (change === 'gentle') return { ...slot, swap: slotTarget(state, session, family, 'gentle')?.id ?? slot.swap, since: at };
  // Décalage relatif au palier de la famille : il suit la personne quand le palier change.
  return { offset: index + (change === 'easier' ? -1 : 1) - (familyPalier(state, family) - 1), swap: null, since: at };
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

/** Familles en toutes lettres, en minuscules : « cardio, poussée et une jambe ». */
export function familyList(families: readonly FitnessFamily[]): string {
  const names = families.map((f) => (f === 'unilateral' ? 'une jambe' : FAMILY_LABELS[f].toLowerCase()));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : (names[0] ?? '');
}

/** Ce qu'est une bonne semaine, dit à la personne. */
export const GOOD_WEEK_TEXT = `${GOOD_WEEK_SESSIONS} séances ou plus, aucune plus dure qu’« exigeant »`;

/** Message du palier : où l'on en est, et ce qui fait passer au suivant. */
export function palierHint({ palier, effort, stage }: Rhythm & { stage?: PalierStage | null }): string {
  if (stage?.waiting.length) return `Palier ${palier} en deux temps : ${familyList(stage.waiting)} y passent après la prochaine bonne semaine (${GOOD_WEEK_TEXT}).`;
  if (palier === 3) return 'Dernier palier : le rythme continue d’augmenter tant que les semaines se passent bien.';
  if (effort >= NEXT_PALIER_EFFORT) return `Une bonne semaine à ce rythme (${GOOD_WEEK_TEXT}) et tu passes au palier ${palier + 1}, en deux temps.`;
  return `Palier ${palier + 1} : après une bonne semaine (${GOOD_WEEK_TEXT}) à ${NEXT_PALIER_EFFORT} s d’effort.`;
}

export const OPTION_LABELS: Record<RhythmOption, string> = {
  keep: 'Garder ce rythme',
  'up-same': '+5 s d’effort, même durée',
  'up-longer': '+5 s d’effort, séance plus longue',
  'down-same': '−5 s d’effort, même durée',
  'down-shorter': '−5 s d’effort, séance plus courte',
  'next-palier': 'Palier suivant',
  'complete-palier': 'Finir le palier',
};
