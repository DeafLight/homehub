// Schémas zod communs aux fichiers du dossier d'état.
import { z } from 'zod';

/** Qui a fait un changement : un profil (ou personne de reconnu), depuis la tablette ou un téléphone. */
export const authorSchema = z.object({ ownerId: z.string().nullable(), via: z.enum(['tablet', 'phone']) });
