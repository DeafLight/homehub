// Codes PIN exigés par la tablette avant un geste sensible (afficher le QR code d'un profil, retirer un téléphone,
// enregistrer un visage) : renvoie si le code passe, lève le refus sinon (403, ou 429 après trop d'essais).
import type { Context } from 'hono';
import { z } from 'zod';
import { fail } from './http.ts';
import { PARENT_PIN_ID, type PinStore } from './sources/pins.ts';

const pinBody = z.object({ pin: z.string().max(20).optional() }).nullable();

/** PIN joint à une suppression ; corps absent ou mal formé : pas de PIN (le refus viendra de la vérification). */
export async function pinInBody(c: Context): Promise<string | undefined> {
  const parsed = pinBody.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data?.pin : undefined;
}

export type PinGate = {
  /** Profils protégés par un PIN (sans le code parent), et code parent défini. */
  protection(): Promise<{ protected: string[]; parent: boolean }>;
  /** Exige le PIN de `ownerId`, s'il en a un. */
  owner(ownerId: string, pin: string | undefined): Promise<void>;
  /** Exige le PIN de `ownerId` ou le code parent, quand l'un d'eux est défini. */
  ownerOrParent(ownerId: string, pin: string | undefined): Promise<void>;
  /** Exige le code parent, qui doit être défini (sans lui, n'importe qui pourrait se faire passer pour un parent). */
  parent(pin: string | undefined): Promise<void>;
};

export function createPinGate(pins: PinStore): PinGate {
  /** Vérifie `pin` contre l'un des codes `ids` (aucun : rien à vérifier). */
  async function check(ids: string[], pin: string | undefined) {
    if (ids.length === 0) return;
    if (!pin) return fail(403, 'Code PIN requis');
    const result = await pins.check(ids, pin);
    if (result.ok) return;
    if (result.reason === 'locked') {
      const minutes = Math.max(1, Math.ceil(result.waitMs / 60_000));
      return fail(429, `Trop d’essais : réessaie dans ${minutes} min`);
    }
    return fail(403, 'Code PIN incorrect');
  }

  const defined = async (ids: string[]) => {
    const protectedIds = await pins.protectedIds();
    return ids.filter((id) => protectedIds.includes(id));
  };

  return {
    async protection() {
      const ids = await pins.protectedIds();
      return { protected: ids.filter((id) => id !== PARENT_PIN_ID), parent: ids.includes(PARENT_PIN_ID) };
    },
    owner: async (ownerId, pin) => check(await defined([ownerId]), pin),
    ownerOrParent: async (ownerId, pin) => check(await defined([ownerId, PARENT_PIN_ID]), pin),
    async parent(pin) {
      if ((await defined([PARENT_PIN_ID])).length === 0) return fail(403, 'Définis d’abord le code parent');
      return check([PARENT_PIN_ID], pin);
    },
  };
}
