// Schémas zod communs aux fichiers du dossier d'état.
import { z } from 'zod';

/** Qui a fait un changement : un profil (ou personne de reconnu), depuis la tablette ou un téléphone. */
export const authorSchema = z.object({ ownerId: z.string().nullable(), via: z.enum(['tablet', 'phone']) });

/** Vrai seulement si A et B sont le même type (chacun assignable à l'autre). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Vérifie à la compilation qu'un schéma zod lit exactement un type partagé avec le client (shared/) : un champ ajouté
 * d'un côté seulement fait échouer `npm run check`. Ne fait rien à l'exécution.
 */
export const sameShape = <A, B>(check: Same<A, B>) => check;
