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
