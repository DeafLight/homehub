// Sonnerie du minuteur pour les appareils Cast (Google Home) : un fichier WAV fabriqué ici par le calcul, rien de
// copié. Un carillon de deux notes (la et mi, avec leur harmonique et une extinction douce, comme une cloche), répété
// chaque seconde et demie pendant RINGTONE_SECONDS. Mono, 16 bits, 16 kHz : léger (≈ 320 ko), lu partout.

export const RINGTONE_SECONDS = 10;
export const RINGTONE_RATE = 16_000;
export const RINGTONE_TYPE = 'audio/wav';
/** Un motif « ding-dong » toutes les 1,5 s. */
const PATTERN_S = 1.5;
/** Les deux coups du motif : début (s) et fréquence (Hz). */
const STRIKES = [
  { at: 0, hz: 880 },
  { at: 0.35, hz: 659.25 },
];
const DECAY_S = 0.45;

/** Échantillon (−1 à 1) au temps t (s). */
function sample(t: number): number {
  const local = t % PATTERN_S;
  let value = 0;
  for (const { at, hz } of STRIKES) {
    const dt = local - at;
    if (dt < 0) continue;
    // Attaque de 5 ms (pas de clic), puis extinction exponentielle ; l'harmonique s'éteint plus vite.
    const attack = Math.min(1, dt / 0.005);
    value += attack * Math.exp(-dt / DECAY_S) * (0.6 * Math.sin(2 * Math.PI * hz * dt) + 0.25 * Math.exp(-dt / 0.15) * Math.sin(4 * Math.PI * hz * dt));
  }
  // Fondu sur la dernière demi-seconde : la sonnerie ne se coupe pas net.
  const fade = Math.min(1, (RINGTONE_SECONDS - t) / 0.5);
  return Math.max(-1, Math.min(1, value * fade));
}

/** Le fichier WAV complet (en-tête RIFF de 44 octets, puis les échantillons). */
export function buildRingtone(seconds = RINGTONE_SECONDS, rate = RINGTONE_RATE): Buffer {
  const count = Math.round(seconds * rate);
  const data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(sample(i / rate) * 32_000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16); // taille du bloc fmt
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28); // octets par seconde
  head.writeUInt16LE(2, 32); // octets par échantillon
  head.writeUInt16LE(16, 34); // bits par échantillon
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

let cached: Buffer | null = null;
/** La sonnerie, calculée une fois. */
export function ringtone(): Buffer {
  return (cached ??= buildRingtone());
}
