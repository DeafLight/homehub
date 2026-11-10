// Réponse commune aux pages de réglages (routines, transports) quand l'envoi ne passe pas la validation.
import type { z } from 'zod';

/** « Réglages refusés : <premier problème> ». */
export const settingsRefused = (error: z.ZodError) => `Réglages refusés : ${error.issues[0]?.message ?? 'format inattendu'}`;
