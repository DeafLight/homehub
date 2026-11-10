// Données accessoires (météo, emploi du temps, devoirs, passages de bus…) : une panne de la source masque le bloc
// et laisse un message dans le journal, au lieu de faire échouer tout l'écran.
import type { Logger } from '../config-store.ts';

/** Résultat de `load`, ou `fallback` (et le message « <what> : <erreur> ») si la source est en panne. */
export async function accessory<T>(logger: Pick<Logger, 'error'>, what: string, load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (err) {
    logger.error(`${what} : ${(err as Error).message}`);
    return fallback;
  }
}
