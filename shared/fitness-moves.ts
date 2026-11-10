// Animations des exercices : un bonhomme en bâtons, vu de profil (ou de face), et deux à quatre positions clés par
// exercice, entre lesquelles l'animation passe en boucle. Dessins faits maison, aucune image externe.
//
// Angles en degrés, dans le plan de l'image : 0 vers le bas, 90 vers l'avant (la droite de l'image, où regarde la
// personne de profil), 180 vers le haut, −90 vers l'arrière. Chaque segment a son angle absolu.
//
// Deux façons de décrire une position :
// - par angles seuls : le dessin est ensuite posé au sol (point le plus bas sur le sol, ou `lift` au-dessus pour un
//   saut) et calé horizontalement sur `anchor` (le pied qui ne bouge pas, les mains…) ;
// - par points, avec `fig()` : hanche, cou, mains et chevilles donnés dans le repère du sol (y = 0 au sol, négatif
//   vers le haut) ; les angles des bras et des jambes s'en déduisent. Pour les exercices avec un meuble (chaise,
//   marche, mur, table) : les mains et les pieds tombent dessus.

export const LEN = { torso: 30, neck: 9, head: 6.5, upper: 15, fore: 14, thigh: 21, shin: 20, foot: 7 } as const;

export type Pt = readonly [number, number];
/** Haut du bras, avant-bras ; `scale` raccourcit un bras vu en raccourci (tendu vers le côté). */
export type Arm = readonly [number, number, number?];
/** Cuisse, tibia, pied ; `scale` raccourcit le tibia et le pied vus en raccourci. */
export type Leg = readonly [number, number, number, number?];
export type Pose = {
  torso: number;
  head?: number;
  /** [proche, éloigné] : de profil, le bras et la jambe éloignés sont dessinés plus pâles. */
  arms: readonly [Arm, Arm];
  legs: readonly [Leg, Leg];
  /** Position de la hanche dans le repère du sol (positions décrites par points) : ni calage ni pose au sol. */
  at?: Pt;
  /** Décalage horizontal après calage (pas chassés). */
  dx?: number;
  /** Hauteur au-dessus du sol (saut, debout sur une marche). */
  lift?: number;
  /** Temps passé dans cette position avant la suivante, en secondes. */
  hold?: number;
};
export type Anchor = 'nFoot' | 'fFoot' | 'nKnee' | 'hands' | 'hip' | 'neck';
export type Prop =
  | { kind: 'block'; x: number; w: number; h: number }
  | { kind: 'chair'; x: number; h: number; back: 1 | -1 }
  | { kind: 'wall'; x: number }
  | { kind: 'table'; x1: number; x2: number; h: number }
  /** Porte fermée, et la serviette (ou l'élastique, `band`) tenue par les mains, accrochée à sa poignée. */
  | { kind: 'door'; x: number; handle: number; band?: true };
export type Move = {
  view: 'side' | 'front';
  anchor?: Anchor;
  poses: readonly Pose[];
  props?: readonly Prop[];
  /** Durée d'un passage d'une position à la suivante, en secondes. */
  tempo?: number;
};

export type Figure = {
  hip: Pt;
  neck: Pt;
  head: Pt;
  /** [coude, main] pour chaque bras. */
  arms: readonly [readonly [Pt, Pt], readonly [Pt, Pt]];
  /** [genou, cheville, orteils] pour chaque jambe. */
  legs: readonly [readonly [Pt, Pt, Pt], readonly [Pt, Pt, Pt]];
};

const RAD = Math.PI / 180;
const step = ([x, y]: Pt, angle: number, length: number): Pt => [x + Math.sin(angle * RAD) * length, y + Math.cos(angle * RAD) * length];
/** Angle de la direction (x, y). */
export const dirOf = (x: number, y: number) => Math.atan2(x, y) / RAD;

/**
 * Angles de deux segments (longueurs `a` et `b`) qui partent de l'origine et atteignent (x, y) ; `bend` choisit de quel
 * côté plie l'articulation du milieu (+1 : en tournant vers les angles croissants, genou vers l'avant debout).
 */
export function reach(x: number, y: number, a: number, b: number, bend: 1 | -1): [number, number] {
  const d = Math.min(a + b - 0.01, Math.max(Math.abs(a - b) + 0.01, Math.hypot(x, y)));
  const base = dirOf(x, y);
  const alpha = Math.acos(Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)))) / RAD;
  const first = base + bend * alpha;
  const [mx, my] = step([0, 0], first, a);
  return [first, dirOf(x - mx, y - my)];
}

type Bend = 1 | -1;
const pair = (v: Pt | readonly [Pt, Pt]): readonly [Pt, Pt] => (typeof v[0] === 'number' ? [v as Pt, v as Pt] : (v as readonly [Pt, Pt]));
const pairN = (v: number | readonly [number, number]): readonly [number, number] => (typeof v === 'number' ? [v, v] : v);
const pairB = (v: Bend | readonly [Bend, Bend]): readonly [Bend, Bend] => (typeof v === 'number' ? [v, v] : v);

/** Position décrite par points (repère du sol). */
export function fig(o: {
  hip: Pt;
  neck: Pt;
  hands: Pt | readonly [Pt, Pt];
  feet: Pt | readonly [Pt, Pt];
  elbows?: Bend | readonly [Bend, Bend];
  knees?: Bend | readonly [Bend, Bend];
  toes?: number | readonly [number, number];
  head?: number;
  hold?: number;
}): Pose {
  const torso = dirOf(o.neck[0] - o.hip[0], o.neck[1] - o.hip[1]);
  const neck = step(o.hip, torso, LEN.torso);
  const hands = pair(o.hands);
  const feet = pair(o.feet);
  const elbows = pairB(o.elbows ?? -1);
  const knees = pairB(o.knees ?? 1);
  const toes = pairN(o.toes ?? 90);
  const arm = (i: 0 | 1): Arm => reach(hands[i][0] - neck[0], hands[i][1] - neck[1], LEN.upper, LEN.fore, elbows[i]);
  const leg = (i: 0 | 1): Leg => [...reach(feet[i][0] - o.hip[0], feet[i][1] - o.hip[1], LEN.thigh, LEN.shin, knees[i]), toes[i]];
  return { torso, head: o.head, arms: [arm(0), arm(1)], legs: [leg(0), leg(1)], at: o.hip, hold: o.hold };
}

/** Bras et jambes de figure brute, hanche à l'origine (ou à `at`). */
function build(pose: Pose): Figure {
  const hip: Pt = pose.at ?? [0, 0];
  const neck = step(hip, pose.torso, LEN.torso);
  const head = step(neck, pose.head ?? pose.torso, LEN.neck);
  const arm = ([a, b, scale = 1]: Arm): readonly [Pt, Pt] => {
    const elbow = step(neck, a, LEN.upper * scale);
    return [elbow, step(elbow, b, LEN.fore * scale)];
  };
  const leg = ([a, b, c, scale = 1]: Leg): readonly [Pt, Pt, Pt] => {
    const knee = step(hip, a, LEN.thigh);
    const ankle = step(knee, b, LEN.shin * scale);
    return [knee, ankle, step(ankle, c, LEN.foot * scale)];
  };
  return { hip, neck, head, arms: [arm(pose.arms[0]), arm(pose.arms[1])], legs: [leg(pose.legs[0]), leg(pose.legs[1])] };
}

export const pointsOf = (f: Figure): Pt[] => [f.hip, f.neck, ...f.arms.flat(), ...f.legs.flat()];

function anchorOf(f: Figure, anchor: Anchor): Pt {
  switch (anchor) {
    case 'nFoot': return f.legs[0][1];
    case 'fFoot': return f.legs[1][1];
    case 'nKnee': return f.legs[0][0];
    case 'hands': return f.arms[0][1];
    case 'neck': return f.neck;
    default: return f.hip;
  }
}

/** La figure d'une position, posée dans le repère du sol. */
export function place(move: Pick<Move, 'anchor'>, pose: Pose): Figure {
  const raw = build(pose);
  const lowest = Math.max(raw.head[1] + LEN.head, ...pointsOf(raw).map(([, y]) => y));
  // Positions décrites par points : gardées telles quelles, sauf si l'interpolation enfonce un pied dans le sol.
  if (pose.at && lowest <= 0) return raw;
  const dx = pose.at ? 0 : -anchorOf(raw, move.anchor ?? 'nFoot')[0] + (pose.dx ?? 0);
  const dy = pose.at ? -lowest : -lowest - (pose.lift ?? 0);
  const t = ([x, y]: Pt): Pt => [x + dx, y + dy];
  return {
    hip: t(raw.hip),
    neck: t(raw.neck),
    head: t(raw.head),
    arms: [[t(raw.arms[0][0]), t(raw.arms[0][1])], [t(raw.arms[1][0]), t(raw.arms[1][1])]],
    legs: [raw.legs[0].map(t) as unknown as readonly [Pt, Pt, Pt], raw.legs[1].map(t) as unknown as readonly [Pt, Pt, Pt]],
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Interpole un angle par le plus court chemin. */
const lerpAngle = (a: number, b: number, t: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

export function blend(a: Pose, b: Pose, t: number): Pose {
  const arm = (x: Arm, y: Arm): Arm => [lerpAngle(x[0], y[0], t), lerpAngle(x[1], y[1], t), lerp(x[2] ?? 1, y[2] ?? 1, t)];
  const leg = (x: Leg, y: Leg): Leg => [lerpAngle(x[0], y[0], t), lerpAngle(x[1], y[1], t), lerpAngle(x[2], y[2], t), lerp(x[3] ?? 1, y[3] ?? 1, t)];
  return {
    torso: lerpAngle(a.torso, b.torso, t),
    head: lerpAngle(a.head ?? a.torso, b.head ?? b.torso, t),
    arms: [arm(a.arms[0], b.arms[0]), arm(a.arms[1], b.arms[1])],
    legs: [leg(a.legs[0], b.legs[0]), leg(a.legs[1], b.legs[1])],
    at: a.at && b.at ? [lerp(a.at[0], b.at[0], t), lerp(a.at[1], b.at[1], t)] : undefined,
    dx: lerp(a.dx ?? 0, b.dx ?? 0, t),
    lift: lerp(a.lift ?? 0, b.lift ?? 0, t),
  };
}

export const DEFAULT_TEMPO = 0.8;
export const DEFAULT_HOLD = 0.15;

/** Durée d'un cycle complet, en secondes. */
export const cycleSeconds = (move: Move) =>
  move.poses.length < 2 ? 0 : move.poses.reduce((sum, p) => sum + (move.tempo ?? DEFAULT_TEMPO) + (p.hold ?? DEFAULT_HOLD), 0);

const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;

/** La position à l'instant `time` (secondes) du cycle. */
export function poseAt(move: Move, time: number): Pose {
  const { poses } = move;
  if (poses.length < 2) return poses[0];
  const tempo = move.tempo ?? DEFAULT_TEMPO;
  let t = time % cycleSeconds(move);
  for (let i = 0; i < poses.length; i++) {
    const hold = poses[i].hold ?? DEFAULT_HOLD;
    if (t < hold) return poses[i];
    t -= hold;
    if (t < tempo) return blend(poses[i], poses[(i + 1) % poses.length], ease(t / tempo));
    t -= tempo;
  }
  return poses[0];
}

/** Cadre qui contient toutes les positions (échantillonnées) et les meubles, avec une marge. */
export function frameOf(move: Move): { x: number; y: number; w: number; h: number } {
  const pts: Pt[] = [[0, 0]];
  const cycle = cycleSeconds(move);
  const samples = cycle ? 48 : 1;
  for (let i = 0; i < samples; i++) {
    const f = place(move, poseAt(move, (i / samples) * cycle));
    pts.push(...pointsOf(f), [f.head[0] - LEN.head, f.head[1] - LEN.head], [f.head[0] + LEN.head, f.head[1] + LEN.head]);
  }
  for (const p of move.props ?? []) {
    if (p.kind === 'block') pts.push([p.x, -p.h], [p.x + p.w, 0]);
    if (p.kind === 'chair') pts.push([p.x - 10, -p.h - 20], [p.x + 10, 0]);
    if (p.kind === 'wall') pts.push([p.x, -10]);
    if (p.kind === 'table') pts.push([p.x1, -p.h], [p.x2, 0]);
    if (p.kind === 'door') pts.push([p.x + 2, -p.handle]);
  }
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  const pad = 8;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  // Assez large pour un rendu équilibré, assez haut pour un debout.
  const w = Math.max(70, Math.max(...xs) + pad - x);
  const h = Math.max(60, Math.max(...ys) + 4 - y);
  return { x: x - (w - (Math.max(...xs) + pad - x)) / 2, y, w, h };
}

// ---------------------------------------------------------------------------------------------------------------
// Positions courantes, décrites par angles.

/** Symétrique d'une position vue de face (gauche ↔ droite). */
const mirror = (p: Pose): Pose => {
  const arm = ([a, b, s]: Arm): Arm => [-a, -b, s];
  const leg = ([a, b, c, s]: Leg): Leg => [-a, -b, -c, s];
  return { ...p, torso: -p.torso, head: p.head === undefined ? undefined : -p.head, arms: [arm(p.arms[1]), arm(p.arms[0])], legs: [leg(p.legs[1]), leg(p.legs[0])], dx: p.dx === undefined ? undefined : -p.dx };
};

const STAND: Pose = { torso: 180, arms: [[6, 14], [-6, -2]], legs: [[2, -2, 90], [-2, 2, 90]] };
const CROUCH: Pose = { torso: 112, arms: [[8, -6], [4, -8]], legs: [[82, -38, 90], [78, -34, 90]] };
const PLANK: Pose = { torso: 103, arms: [[0, 0], [3, 3]], legs: [[-68, -68, 0], [-70, -70, 0]] };
const PUSH_DOWN: Pose = { torso: 92, arms: [[-55, 45], [-52, 42]], legs: [[-75, -75, 0], [-76, -76, 0]] };
const JUMP: Pose = { torso: 180, arms: [[165, 175], [155, 170]], legs: [[0, 0, 30], [-3, 0, 30]], lift: 9 };
const SQ_DEEP: Pose = { torso: 145, arms: [[95, 95], [90, 90]], legs: [[82, -32, 90], [78, -30, 90]] };
const SQ_HALF: Pose = { torso: 155, arms: [[90, 92], [86, 88]], legs: [[62, -24, 90], [58, -22, 90]] };
const knee = (side: 0 | 1, thigh: number, lift = 0): Pose => {
  const up: Leg = [thigh, -5, 70];
  const down: Leg = [0, 0, 90];
  const back: Arm = [-30, 10];
  const front: Arm = [40, 120];
  return { torso: 180, arms: side === 0 ? [back, front] : [front, back], legs: side === 0 ? [up, down] : [down, up], lift };
};

// Vues de face.
const JJ_CLOSED: Pose = { torso: 180, arms: [[14, 4], [-14, -4]], legs: [[4, 0, 90], [-4, 0, -90]] };
const JJ_OPEN: Pose = { torso: 180, arms: [[140, 160], [-140, -160]], legs: [[22, 18, 90], [-22, -18, -90]] };
const WIDE: Pose = { torso: 180, arms: [[25, -160], [-25, 160]], legs: [[24, 12, 90], [-24, -12, -90]] };
const TOGETHER: Pose = { ...WIDE, legs: [[6, 2, 90], [-6, -2, -90]] };
const SKATE: Pose = { torso: 168, arms: [[-40, -30], [-70, -60]], legs: [[8, -8, 90], [22, 50, 90]], dx: 12 };
const SKATE_AIR: Pose = { torso: 180, arms: [[10, 5], [-10, -5]], legs: [[6, 10, 90], [-6, -10, -90]], lift: 8 };
const SUMO_UP: Pose = { torso: 180, arms: [[20, 170], [-20, -170]], legs: [[18, 18, 90], [-18, -18, -90]] };
const SUMO_DOWN: Pose = { torso: 180, arms: [[25, 175], [-25, -175]], legs: [[60, -12, 90], [-60, 12, -90]] };
const SUMO_JUMP: Pose = { torso: 180, arms: [[160, 170], [-160, -170]], legs: [[14, 14, 40], [-14, -14, -40]], lift: 10 };

// Sans saut : une jambe s'écarte puis l'autre, bras en haut (jumping jacks) ; pieds reculés un à un (burpees).
const JJ_STEP = (side: 0 | 1): Pose => ({ ...JJ_OPEN, legs: side === 0 ? [JJ_OPEN.legs[0], JJ_CLOSED.legs[1]] : [JJ_CLOSED.legs[0], JJ_OPEN.legs[1]] });
const STEP_BACK: Pose = { torso: 106, arms: [[2, 0], [4, 2]], legs: [[-68, -68, 0], [80, -36, 90]] };
const REACH_UP: Pose = { ...STAND, arms: [[175, 180], [170, 178]] };

// Au sol, à plat ventre (tête à droite) et sur le dos (tête à gauche).
const PRONE: Pose = { torso: 90, head: 90, arms: [[90, 90], [92, 92]], legs: [[-90, -90, -170], [-92, -92, -170]] };
const SUPERMAN: Pose = { torso: 100, head: 108, arms: [[108, 108], [110, 110]], legs: [[-100, -100, -170], [-102, -102, -170]] };
const FOREARM_PLANK: Pose = { torso: 96.5, arms: [[0, 90], [2, 90]], legs: [[-83.5, -83.5, 0], [-84, -84, 0]] };
const KNEE_FOREARM_PLANK: Pose = { torso: 107, arms: [[0, 90], [2, 90]], legs: [[-73, -130, -150], [-74, -130, -150]] };
const ALL_FOURS: Pose = { torso: 105, head: 100, arms: [[0, 0], [2, 2]], legs: [[0, -90, -170], [2, -90, -170]] };
const SUPINE: Pose = { torso: -90, head: -90, arms: [[180, 180], [178, 178]], legs: [[180, 90, 90], [178, 90, 90]] };
const SIDE_PLANK: Pose = { torso: -102, arms: [[0, 90], [180, 180]], legs: [[78, 78, 90], [76, 76, 90]] };
const SIDE_DOWN: Pose = { torso: -110, arms: [[0, 90], [175, 175]], legs: [[90, 90, 90], [88, 88, 90]] };

// ---------------------------------------------------------------------------------------------------------------
// Positions décrites par points (repère du sol), pour les exercices avec un meuble ou un appui fixe.

// Ponts fessiers : allongé sur le dos, tête à gauche, épaules au sol.
const SHOULDERS: Pt = [-42, -6.5];
const bridgeHip = (up: boolean, toward: Pt = [32, 14.5]): Pt => {
  if (!up) return [-12, -4];
  const d = Math.hypot(...toward);
  return [SHOULDERS[0] + (toward[0] / d) * 30, SHOULDERS[1] - (toward[1] / d) * 30];
};
const bridge = (up: boolean, feet: Pt | readonly [Pt, Pt] = [14, 0], extra: Partial<Parameters<typeof fig>[0]> = {}) =>
  fig({ hip: bridgeHip(up), neck: SHOULDERS, head: -90, hands: [[-14, -2], [-15, -2]], elbows: 1, feet, toes: 90, ...extra });
/** Jambe tendue dans le prolongement du corps (pont sur une jambe). */
const legLine = (hip: Pt, rise: number): Pt => {
  const dir = up(hip, rise);
  return [hip[0] + dir[0] * 41, hip[1] + dir[1] * 41];
};
const up = (hip: Pt, rise: number): Pt => {
  const v: Pt = [hip[0] - SHOULDERS[0], hip[1] - SHOULDERS[1] - rise];
  const d = Math.hypot(...v);
  return [v[0] / d, v[1] / d];
};

const UP_HIP = bridgeHip(true);
const RAISED_HIP = bridgeHip(true, [28, 17.5]);

// Rowing à l'élastique : debout face à la porte (à droite), l'élastique accroché à hauteur de poitrine.
const BAND_DOOR: Prop = { kind: 'door', x: 52, handle: 64, band: true };
const ROW_HANDS_OUT: Pt = [27, -64];
const ROW_HANDS_IN: Pt = [4, -59];
const row = (hands: Pt | readonly [Pt, Pt], hold?: number) =>
  fig({ hip: [-1, -40], neck: [0, -70], hands, feet: [[1, 0], [-1, 0]], hold });
/** Un bras, en fente : le bras proche tire, l'autre main sur la hanche. */
const rowOneArm = (hand: Pt, hold?: number) =>
  fig({ hip: [-2, -38], neck: [-1, -68], hands: [hand, [2, -40]], feet: [[-12, 0], [9, 0]], toes: [20, 90], hold });

const lunge = (front: Pt, rear: Pt, hip: Pt, frontLeg: 0 | 1 = 0) => {
  const feet: readonly [Pt, Pt] = frontLeg === 0 ? [front, rear] : [rear, front];
  const toes: readonly [number, number] = frontLeg === 0 ? [90, 20] : [20, 90];
  return fig({ hip, neck: [hip[0], hip[1] - 30], hands: [[hip[0] + 3, hip[1] - 2], [hip[0] - 3, hip[1] - 2]], feet, toes });
};

// ---------------------------------------------------------------------------------------------------------------

export const MOVES: Record<string, Move> = {
  // --- Cardio
  'jumping-jacks': { view: 'front', anchor: 'hip', poses: [JJ_CLOSED, JJ_OPEN], tempo: 0.45 },
  'half-burpees': { view: 'side', poses: [STAND, CROUCH, PLANK, CROUCH], tempo: 0.6 },
  burpees: { view: 'side', poses: [STAND, CROUCH, PLANK, PUSH_DOWN, PLANK, CROUCH, JUMP], tempo: 0.5 },
  'genoux-hauts-marche': { view: 'side', anchor: 'hip', poses: [knee(0, 75), STAND, knee(1, 75), STAND], tempo: 0.45 },
  'genoux-hauts': { view: 'side', anchor: 'hip', poses: [knee(0, 95, 3), knee(1, 95, 3)], tempo: 0.3 },
  'mountain-climbers': {
    view: 'side',
    anchor: 'hands',
    poses: [{ ...PLANK, legs: [[45, -100, -60], PLANK.legs[1]] }, { ...PLANK, legs: [PLANK.legs[0], [45, -100, -60]] }],
    tempo: 0.35,
  },
  'pas-chasses': { view: 'front', anchor: 'hip', poses: [WIDE, { ...TOGETHER, dx: 9 }, { ...WIDE, dx: 18 }, { ...TOGETHER, dx: 9 }], tempo: 0.4 },
  patineurs: { view: 'front', anchor: 'hip', poses: [SKATE, mirror(SKATE)], tempo: 0.7 },
  'patineurs-sautes': { view: 'front', anchor: 'hip', poses: [SKATE, SKATE_AIR, mirror(SKATE), SKATE_AIR], tempo: 0.35 },
  'jacks-sans-saut': { view: 'front', anchor: 'hip', poses: [JJ_CLOSED, JJ_STEP(0), JJ_CLOSED, JJ_STEP(1)], tempo: 0.45 },
  'burpees-sans-saut': { view: 'side', poses: [STAND, CROUCH, STEP_BACK, PLANK, STEP_BACK, CROUCH, REACH_UP], tempo: 0.5 },
  'marche-sur-place': { view: 'side', anchor: 'hip', poses: [knee(0, 45), STAND, knee(1, 45), STAND], tempo: 0.45 },

  // --- Jambes
  'squat-chaise': { view: 'side', poses: [STAND, { ...SQ_HALF, hold: 0.3 }], props: [{ kind: 'chair', x: -14, h: 23, back: -1 }] },
  squats: { view: 'side', poses: [STAND, SQ_DEEP] },
  'squats-sautes': { view: 'side', poses: [SQ_DEEP, JUMP], tempo: 0.5 },
  // Descente en deux temps, pause en bas, remontée franche.
  'squats-lents': { view: 'side', poses: [STAND, { ...blend(STAND, SQ_DEEP, 0.5), hold: 0 }, { ...SQ_DEEP, hold: 1 }], tempo: 1 },
  'chaise-mur': {
    view: 'side',
    poses: [
      fig({ hip: [0, -41], neck: [0, -71], hands: [[2, -43], [1, -43]], feet: [[8, 0], [7, 0]] }),
      fig({ hip: [0, -20], neck: [0, -50], hands: [[14, -22], [12, -22]], feet: [[21, 0], [20, 0]], hold: 2.4 }),
    ],
    props: [{ kind: 'wall', x: -4 }],
    tempo: 1.1,
  },
  'squats-sumo': { view: 'front', anchor: 'hip', poses: [SUMO_UP, SUMO_DOWN] },
  'squats-sumo-lents': { view: 'front', anchor: 'hip', poses: [SUMO_UP, { ...blend(SUMO_UP, SUMO_DOWN, 0.5), hold: 0 }, { ...SUMO_DOWN, hold: 1 }], tempo: 1 },
  'squats-sumo-sautes': { view: 'front', anchor: 'hip', poses: [SUMO_DOWN, SUMO_JUMP], tempo: 0.5 },
  'montees-marche': {
    view: 'side',
    poses: [
      fig({ hip: [0, -38], neck: [4, -68], hands: [[-6, -42], [10, -43]], feet: [[12, -12], [-4, 0]] }),
      fig({ hip: [13, -53], neck: [13, -83], hands: [[16, -55], [11, -55]], feet: [[14, -12], [12, -12]] }),
    ],
    props: [{ kind: 'block', x: 5, w: 30, h: 12 }],
  },
  'montees-genou': {
    view: 'side',
    poses: [
      fig({ hip: [0, -38], neck: [4, -68], hands: [[-6, -42], [10, -43]], feet: [[12, -12], [-4, 0]] }),
      fig({ hip: [14, -53], neck: [14, -83], hands: [[24, -63], [6, -56]], feet: [[14, -12], [35, -33]], toes: [90, 60], hold: 0.3 }),
    ],
    props: [{ kind: 'block', x: 5, w: 30, h: 12 }],
  },
  'fentes-bulgares': {
    view: 'side',
    poses: [
      fig({ hip: [-3.7, -40.2], neck: [-1.1, -70.1], hands: [[1, -42], [-2, -42]], feet: [[0, 0], [-33.9, -25.5]], toes: [90, -95] }),
      fig({ hip: [-14.5, -26.5], neck: [-10.3, -56.2], hands: [[-8, -28], [-11, -28]], feet: [[0, 0], [-33.9, -25.5]], toes: [90, -95] }),
    ],
    props: [{ kind: 'chair', x: -40, h: 23.5, back: -1 }],
    tempo: 1,
  },

  // --- Poussée
  'pompes-mur': {
    view: 'side',
    poses: [
      fig({ hip: [14, -38.5], neck: [24.3, -66.7], hands: [[52.9, -71.7], [52.4, -71]], feet: [[0, 0], [-1, 0]] }),
      fig({ hip: [20.5, -35.5], neck: [35.5, -61.5], hands: [[52.9, -71.7], [52.4, -71]], feet: [[0, 0], [-1, 0]] }),
    ],
    props: [{ kind: 'wall', x: 55 }],
  },
  'pompes-inclinees': {
    view: 'side',
    poses: [
      fig({ hip: [24.3, -36], neck: [42, -63.6], hands: [[48, -31.5], [47, -31.5]], feet: [[0, -6.5], [-1, -6.5]], toes: 20 }),
      fig({ hip: [31.2, -29.6], neck: [54, -52], hands: [[48, -31.5], [47, -31.5]], feet: [[0, -6.5], [-1, -6.5]], toes: 20 }),
    ],
    props: [{ kind: 'block', x: 44, w: 32, h: 30 }],
  },
  pompes: { view: 'side', poses: [PLANK, PUSH_DOWN] },
  'pompes-larges': { view: 'side', poses: [PLANK, PUSH_DOWN] },
  'pompes-genoux': {
    view: 'side',
    anchor: 'nKnee',
    poses: [
      { torso: 124.7, arms: [[0, 0], [2, 2]], legs: [[-55.3, -120, -140], [-56, -120, -140]] },
      { torso: 110.7, arms: [[-55, 45], [-52, 42]], legs: [[-69.3, -120, -140], [-70, -120, -140]] },
    ],
  },
  'dips-genoux': {
    view: 'side',
    poses: [
      fig({ hip: [2, -24], neck: [2, -54], hands: [[0, -25], [-1, -25]], feet: [[26, 0], [25, 0]] }),
      fig({ hip: [6.7, -12], neck: [6, -42], hands: [[0, -25], [-1, -25]], feet: [[26, 0], [25, 0]], elbows: -1 }),
    ],
    props: [{ kind: 'chair', x: -7, h: 25, back: -1 }],
  },
  'pompes-piquees': {
    view: 'side',
    poses: [
      { torso: 45, head: 20, arms: [[-5, -5], [-3, -3]], legs: [[-45, -45, 10], [-46, -46, 10]] },
      { torso: 60, head: 30, arms: [[-60, 30], [-58, 28]], legs: [[-45, -45, 10], [-46, -46, 10]] },
    ],
  },
  'dips-jambes-tendues': {
    view: 'side',
    poses: [
      fig({ hip: [6, -24], neck: [2, -53.7], hands: [[0, -25], [-1, -25]], feet: [[39.2, 0], [38.5, 0]], toes: 150 }),
      fig({ hip: [0, -12], neck: [-2, -41.9], hands: [[0, -25], [-1, -25]], feet: [[39.2, 0], [38.5, 0]], toes: 150, elbows: -1 }),
    ],
    props: [{ kind: 'chair', x: -7, h: 25, back: -1 }],
  },

  // --- Fessiers, une jambe
  'pont-fessier': { view: 'side', poses: [bridge(false), { ...bridge(true), hold: 0.3 }] },
  'pont-une-jambe': {
    view: 'side',
    poses: [
      bridge(false, [legLine([-12, -4], 18), [14, 0]], { toes: [120, 90] }),
      { ...bridge(true, [legLine(UP_HIP, 0), [14, 0]], { toes: [120, 90] }), hold: 0.3 },
    ],
  },
  'pont-une-jambe-sureleve': {
    view: 'side',
    poses: [
      bridge(false, [legLine([-12, -4], 18), [16, -24]], { toes: [120, 180] }),
      { ...fig({ hip: RAISED_HIP, neck: SHOULDERS, head: -90, hands: [[-14, -2], [-15, -2]], elbows: 1, feet: [legLine(RAISED_HIP, 0), [16, -24]], toes: [120, 180] }), hold: 0.3 },
    ],
    props: [{ kind: 'chair', x: 20, h: 22, back: 1 }],
  },
  'fentes-arriere': {
    view: 'side',
    poses: [lunge([0, 0], [-3, 0], [-2, -41]), { ...lunge([0, 0], [-34, -3], [-8, -24]), hold: 0.25 }],
  },
  'fentes-alternees': {
    view: 'side',
    poses: [lunge([0, 0], [-1, 0], [0, -41]), { ...lunge([34, 0], [0, -3], [26, -24]), hold: 0.25 }],
  },
  'fentes-sautees': {
    view: 'side',
    poses: [
      lunge([17, 0], [-17, -3], [9, -24], 0),
      fig({ hip: [9, -50], neck: [9, -80], hands: [[16, -66], [2, -66]], feet: [[14, -12], [4, -12]], toes: 40 }),
      lunge([17, 0], [-17, -3], [9, -24], 1),
      fig({ hip: [9, -50], neck: [9, -80], hands: [[2, -66], [16, -66]], feet: [[4, -12], [14, -12]], toes: 40 }),
    ],
    tempo: 0.35,
  },
  'pont-pause': { view: 'side', poses: [bridge(false), { ...bridge(true), hold: 1.6 }] },
  'pont-marche': {
    view: 'side',
    poses: [bridge(true, [[14, 0], [14, 0]]), bridge(true, [[19, 0], [14, 0]]), bridge(true, [[19, 0], [19, 0]]), bridge(true, [[14, 0], [19, 0]])],
    tempo: 0.45,
  },
  'squat-une-jambe': {
    view: 'side',
    poses: [
      fig({ hip: [-2, -41], neck: [4, -70], hands: [[30, -64], [29, -64]], feet: [[0, 0], [24, -22]], toes: [90, 100], elbows: 1 }),
      fig({ hip: [-12, -27], neck: [0, -54.5], hands: [[26, -50], [25, -50]], feet: [[0, 0], [26, -20]], toes: [90, 100], elbows: 1 }),
    ],
    props: [{ kind: 'chair', x: -14, h: 23, back: -1 }],
    tempo: 1,
  },

  // --- Dos
  superman: { view: 'side', anchor: 'hip', poses: [PRONE, { ...SUPERMAN, hold: 0.6 }] },
  'superman-w': {
    view: 'side',
    anchor: 'hip',
    poses: [
      { ...PRONE, arms: [[-100, 90], [-98, 92]] },
      { ...SUPERMAN, torso: 102, arms: [[-120, 100], [-118, 102]], hold: 0.8 },
    ],
  },
  'superman-ytw': {
    view: 'side',
    anchor: 'hip',
    poses: [
      { ...SUPERMAN, arms: [[120, 120], [122, 122]], hold: 0.5 },
      { ...SUPERMAN, arms: [[180, 180, 0.35], [180, 180, 0.35]], hold: 0.5 },
      { ...SUPERMAN, arms: [[-120, 100], [-118, 102]], hold: 0.5 },
    ],
  },
  'rowing-elastique': { view: 'side', poses: [row(ROW_HANDS_OUT), row(ROW_HANDS_IN, 0.3)], props: [BAND_DOOR], tempo: 0.9 },
  'rowing-elastique-pause': { view: 'side', poses: [row(ROW_HANDS_OUT), row(ROW_HANDS_IN, 2)], props: [BAND_DOOR], tempo: 1.2 },
  'rowing-elastique-un-bras': {
    view: 'side',
    poses: [rowOneArm([26, -62]), rowOneArm([3, -57], 0.3)],
    props: [{ ...BAND_DOOR, x: 54 }],
    tempo: 0.9,
  },
  'tirage-serviette': {
    view: 'side',
    poses: [
      fig({ hip: [12.7, -37.1], neck: [0, -64.3], hands: [[28.9, -61.8], [28.4, -61.5]], feet: [[30, 0], [29, 0]] }),
      fig({ hip: [21.5, -40.1], neck: [15.2, -69.4], hands: [[25.2, -63.4], [24.7, -63.2]], feet: [[30, 0], [29, 0]], hold: 0.3 }),
    ],
    props: [{ kind: 'door', x: 50, handle: 60 }],
  },
  'superman-nageur': {
    view: 'side',
    anchor: 'hip',
    poses: [
      { ...SUPERMAN, torso: 98, arms: [[115, 115], [92, 92]], legs: [[-90, -90, -170], [-106, -106, -170]] },
      { ...SUPERMAN, torso: 98, arms: [[92, 92], [115, 115]], legs: [[-106, -106, -170], [-90, -90, -170]] },
    ],
    tempo: 0.4,
  },
  'tirage-table': {
    view: 'side',
    poses: [
      fig({ hip: [-29.4, -8.1], neck: [0, -14], hands: [[0, -43], [1, -43]], feet: [[-69.6, 0], [-70.5, 0]], toes: 175 }),
      fig({ hip: [-34.4, -20.8], neck: [-8.6, -36], hands: [[0, -43], [1, -43]], feet: [[-69.6, 0], [-70.5, 0]], toes: 175, hold: 0.3 }),
    ],
    props: [{ kind: 'table', x1: -2, x2: 40, h: 43 }],
  },
  'anges-inverses': {
    view: 'side',
    anchor: 'hip',
    poses: [
      { ...PRONE, torso: 94, head: 92, arms: [[-95, -95], [-93, -93]] },
      { ...PRONE, torso: 94, head: 92, arms: [[180, 180, 0.3], [180, 180, 0.3]] },
      { ...PRONE, torso: 94, head: 92, arms: [[95, 95], [97, 97]] },
      { ...PRONE, torso: 94, head: 92, arms: [[180, 180, 0.3], [180, 180, 0.3]] },
    ],
    tempo: 0.7,
  },
  'anges-bras-tendus': {
    view: 'side',
    anchor: 'hip',
    poses: [
      { ...SUPERMAN, arms: [[-100, -100], [-98, -98]] },
      { ...SUPERMAN, arms: [[180, 180, 0.3], [180, 180, 0.3]] },
      { ...SUPERMAN, arms: [[105, 105], [107, 107]] },
      { ...SUPERMAN, arms: [[180, 180, 0.3], [180, 180, 0.3]] },
    ],
    tempo: 0.7,
  },
  'planche-inversee': {
    view: 'side',
    anchor: 'hands',
    poses: [
      { torso: -160, arms: [[-25, -25], [-23, -23]], legs: [[90, 90, 150], [88, 88, 150]] },
      { torso: -114, arms: [[-8, -8], [-6, -6]], legs: [[66, 66, 150], [64, 64, 150]], hold: 2.4 },
    ],
    tempo: 1.1,
  },

  // --- Gainage
  'planche-genoux': { view: 'side', anchor: 'nKnee', poses: [{ ...KNEE_FOREARM_PLANK, torso: 100, legs: [[-80, -130, -150], [-81, -130, -150]] }, { ...KNEE_FOREARM_PLANK, hold: 2.4 }], tempo: 1.1 },
  planche: { view: 'side', poses: [{ ...KNEE_FOREARM_PLANK }, { ...FOREARM_PLANK, hold: 2.4 }], tempo: 1.1 },
  'planche-touches': {
    view: 'side',
    poses: [
      { ...PLANK, arms: [[40, -150], PLANK.arms[1]], hold: 0.2 },
      PLANK,
      { ...PLANK, arms: [PLANK.arms[0], [40, -150]], hold: 0.2 },
      PLANK,
    ],
    tempo: 0.5,
  },
  'bird-dog': {
    view: 'side',
    anchor: 'nKnee',
    poses: [ALL_FOURS, { ...ALL_FOURS, arms: [[100, 100], ALL_FOURS.arms[1]], legs: [ALL_FOURS.legs[0], [-100, -100, -170]], hold: 0.8 }],
  },
  'dead-bug': {
    view: 'side',
    anchor: 'hip',
    poses: [
      SUPINE,
      { ...SUPINE, arms: [[-100, -100], SUPINE.arms[1]], legs: [SUPINE.legs[0], [100, 100, 90]], hold: 0.3 },
      SUPINE,
      { ...SUPINE, arms: [SUPINE.arms[0], [-100, -100]], legs: [[100, 100, 90], SUPINE.legs[1]], hold: 0.3 },
    ],
  },
  'hollow-hold': {
    view: 'side',
    anchor: 'hip',
    poses: [
      { torso: -90, head: -90, arms: [[-90, -90], [-92, -92]], legs: [[90, 90, 90], [92, 92, 90]] },
      { torso: -100, head: -108, arms: [[-100, -100], [-102, -102]], legs: [[100, 100, 100], [102, 102, 100]], hold: 2.4 },
    ],
    tempo: 1.1,
  },
  'gainage-lateral-genoux': {
    view: 'front',
    anchor: 'neck',
    poses: [
      { ...SIDE_DOWN, legs: [[90, 120, 120, 0.45], [88, 120, 120, 0.45]] },
      { ...SIDE_PLANK, torso: -110, legs: [[75, 120, 120, 0.45], [73, 120, 120, 0.45]], hold: 2.4 },
    ],
    tempo: 1.1,
  },
  'gainage-lateral': { view: 'front', anchor: 'neck', poses: [SIDE_DOWN, { ...SIDE_PLANK, hold: 2.4 }], tempo: 1.1 },
  'gainage-lateral-rotation': {
    view: 'front',
    anchor: 'neck',
    poses: [{ ...SIDE_PLANK, hold: 0.3 }, { ...SIDE_PLANK, torso: -98, arms: [[0, 90], [-40, -10]], hold: 0.3 }],
    tempo: 0.8,
  },
};

// Mains plus écartées : invisible de profil, même animation.
MOVES['pompes-inclinees-larges'] = MOVES['pompes-inclinees'];
