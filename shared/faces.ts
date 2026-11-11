// Empreintes de visage, communes au serveur et à la tablette : ressemblance de deux empreintes, et contrôle d'une
// série de prises. Des prises d'une même personne qui tourne la tête varient toujours un peu ; des prises presque
// identiques signalent une tablette qui calcule mal les empreintes (même résultat pour n'importe quel visage, vu
// avec certaines versions d'Android System WebView et le calcul par la carte graphique). Enregistrées, elles
// rendraient la reconnaissance impossible pour tout le monde : on les refuse, et on signale les profils déjà touchés.

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

/** Ressemblance moyenne des prises entre elles, deux à deux ; null sous MIN_UNIFORM_SAMPLES prises. */
export function meanSimilarity(embeddings: number[][]): number | null {
  if (embeddings.length < MIN_UNIFORM_SAMPLES) return null;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      total += similarity(embeddings[i], embeddings[j]);
      pairs++;
    }
  }
  return total / pairs;
}

/** Prises à comparer, au moins, pour juger une série. */
export const MIN_UNIFORM_SAMPLES = 3;
/**
 * Au-delà, les prises sont trop semblables pour venir d'un vrai visage qui bouge : d'ordinaire 0,7 à 0,85 entre les
 * prises d'une même personne ; 0,99 sur une tablette qui calcule mal.
 */
export const UNIFORM_ABOVE = 0.97;

/** Série de prises anormalement uniforme (tablette qui calcule mal les empreintes). */
export function looksUniform(embeddings: number[][]): boolean {
  const mean = meanSimilarity(embeddings);
  return mean !== null && mean > UNIFORM_ABOVE;
}

/** Message affiché quand une série est refusée, ou qu'un profil enregistré est touché. */
export const UNIFORM_MESSAGE =
  'Empreintes anormales : la tablette donne la même empreinte à tous les visages (WebView ? essaie faces.backend dans homehub.yaml)';
