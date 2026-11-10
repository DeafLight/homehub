// Sons du scanner, synthétisés (rien à télécharger) : un bip clair quand un code est lu, deux notes quand il faut
// répondre à une question (produit inconnu, recharge…), une note grave en cas d'erreur. Le téléphone vibre aussi.
// Le navigateur n'autorise le son qu'après un geste : `unlockAudio` est appelé au toucher (bouton Scanner, modes).

let context: AudioContext | null = null;

export function unlockAudio() {
  try {
    context ??= new AudioContext();
    void context.resume();
  } catch {
    // Pas de son sur cet appareil : l'éclair à l'écran suffit.
  }
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, volume = 0.25) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

export type BeepKind = 'ok' | 'ask' | 'error';

export function beep(kind: BeepKind) {
  navigator.vibrate?.(kind === 'error' ? [80, 60, 80] : 60);
  unlockAudio();
  if (!context) return;
  if (kind === 'ok') tone(context, 1760, 0, 0.12);
  else if (kind === 'ask') {
    tone(context, 1175, 0, 0.1);
    tone(context, 1568, 0.13, 0.12);
  } else tone(context, 330, 0, 0.3, 0.3);
}

/**
 * Bips de la séance guidée : `tick` pour les trois dernières secondes, `go` au début d'un effort, `rest` à sa fin,
 * `side` à la moitié d'un effort d'un côté puis de l'autre (trois notes qui montent, différentes de tout le reste).
 * Rien sans geste préalable (unlockAudio au bouton Commencer).
 */
export function cue(kind: 'tick' | 'go' | 'rest' | 'side') {
  if (!context) return;
  if (kind === 'tick') tone(context, 880, 0, 0.09, 0.2);
  else if (kind === 'go') tone(context, 1320, 0, 0.45, 0.3);
  else if (kind === 'side') {
    tone(context, 784, 0, 0.1, 0.25);
    tone(context, 1047, 0.12, 0.1, 0.25);
    tone(context, 1319, 0.24, 0.18, 0.25);
  } else {
    tone(context, 990, 0, 0.15, 0.25);
    tone(context, 660, 0.18, 0.3, 0.25);
  }
}
