// Qui appelle l'API : la tablette de la maison (reconnue à sa clé, ou à son adresse), un téléphone appairé (jeton),
// ou un autre appareil du réseau, qui ne peut que lire. Et qui modifie : le profil du téléphone, ou la personne
// reconnue devant la tablette ; un parent partout, un enfant sur son profil seulement.
import { createHash, timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { canWrite } from '../shared/rights.ts';
import type { Author, Device } from '../shared/types.ts';
import type { ConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { fail } from './http.ts';
import type { DeviceStore } from './sources/devices.ts';

export type Caller = {
  kiosk: boolean;
  /** Sur la tablette : personne identifiée (reconnaissance faciale), s'il y en a une. */
  actorId?: string | null;
  device: Device | null;
  /** Jeton présenté mais refusé (téléphone retiré depuis la tablette). */
  rejectedToken: boolean;
};

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** En-tête de la clé de la tablette (reçue une fois dans l'adresse de démarrage : /#key=…). */
export const KIOSK_KEY_HEADER = 'x-kiosk-key';
export const KIOSK_KEY_MIN_LENGTH = 20;

/** Reconnaît la clé de la tablette (comparaison à temps constant) ; sans clé configurée, rien ne correspond. */
export function kioskKeyMatcher(key: string | undefined): (presented: string | undefined) => boolean {
  if (!key) return () => false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(key);
  return (presented) => presented !== undefined && timingSafeEqual(digest(presented), expected);
}

export type KioskRule = { addresses: string[]; isKey: (presented: string | undefined) => boolean };

/**
 * Adresse du client. HomeHub n'est joignable que par le proxy (NPM), qui fixe X-Real-IP : on lui fait confiance.
 * Sans proxy (développement), l'adresse de la connexion.
 */
export function clientAddress(c: Context): string | undefined {
  const forwarded = c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0];
  let address = forwarded?.trim();
  if (!address) {
    try {
      address = getConnInfo(c).remote.address;
    } catch {
      return undefined; // requête sans connexion (tests)
    }
  }
  return address?.replace(/^::ffff:/, '');
}

export async function identify(c: Context, devices: DeviceStore, rule: KioskRule): Promise<Caller> {
  const address = clientAddress(c);
  const kiosk =
    rule.isKey(c.req.header(KIOSK_KEY_HEADER)) ||
    (address !== undefined && (LOOPBACK.has(address) || rule.addresses.includes(address)));
  const token = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  const device = token ? await devices.authenticate(token) : null;
  return { kiosk, device, rejectedToken: Boolean(token) && !device };
}

/** Personne identifiée devant la tablette (reconnaissance faciale), présentée avec chaque modification. */
export const ACTOR_HEADER = 'x-actor-session';

export type WriteAccess = { author: Author } | { status: 401 | 403; error: string; identify?: true };

export const REJECTED_PHONE = 'Téléphone non reconnu : à appairer de nouveau';
export const READ_ONLY_DEVICE = 'Lecture seule : appareil non appairé';
export const WHO_ARE_YOU = 'Qui es-tu ? Regarde la tablette pour être reconnu';

/**
 * Qui appelle, et ce qu'il a le droit de faire. Les méthodes qui exigent un droit renvoient de quoi continuer, ou
 * lèvent le refus (HttpError, traduit en réponse par la couche HTTP) : les routes n'ont plus de test à recopier.
 */
export type Access = {
  caller(c: Context): Promise<Caller>;
  /**
   * Qui modifie, s'il en a le droit sur `target` (profil concerné ; null : aucun en particulier) ; sinon le refus
   * (401 : téléphone retiré ; 403 : lecture seule, avec `identify` quand la tablette doit d'abord reconnaître
   * quelqu'un). Le téléphone agit pour son profil ; la tablette, pour la personne identifiée. Un enfant n'écrit que
   * sur son profil.
   */
  writer(c: Context, target: string | null): Promise<Author>;
  /** Un parent (reconnu à la tablette, ou son téléphone) ; `denied` : le refus fait à un enfant. */
  parent(c: Context, denied: string): Promise<Author>;
  /** La tablette de la maison seulement. */
  kiosk(c: Context): Promise<Caller>;
  /** La tablette ou un téléphone appairé (pages qui montrent les adresses de la famille). */
  trusted(c: Context): Promise<Caller>;
  /**
   * Un appareil de la maison, sans exiger de visage (stock : la caméra lit les codes-barres) : l'auteur est le profil
   * du téléphone, ou la personne reconnue à la tablette s'il y en a une.
   */
  appliance(c: Context): Promise<Author>;
};

export function createAccess({
  config,
  devices,
  isKey,
  actorOf,
}: {
  config: ConfigStore;
  devices: DeviceStore;
  isKey: (presented: string | undefined) => boolean;
  /** Personne d'une session ouverte par la reconnaissance faciale, ou null. */
  actorOf: (token: string | undefined) => string | null;
}): Access {
  const household = createHousehold(config);

  const caller = async (c: Context) => {
    const who = await identify(c, devices, { addresses: config.current().kiosk.addresses, isKey });
    return { ...who, actorId: who.kiosk ? actorOf(c.req.header(ACTOR_HEADER)) : null };
  };

  async function write(c: Context, target: string | null): Promise<WriteAccess> {
    const who = await caller(c);
    if (who.rejectedToken) return { status: 401, error: REJECTED_PHONE };
    const actorId = who.device?.ownerId ?? (who.kiosk ? who.actorId : null);
    if (!actorId) {
      return who.kiosk ? { status: 403, error: WHO_ARE_YOU, identify: true } : { status: 403, error: READ_ONLY_DEVICE };
    }
    const actor = household.member(actorId);
    if (!actor) return { status: 403, error: 'Profil inconnu' };
    if (target !== null && !canWrite(actor, target)) return { status: 403, error: `Lecture seule : profil de ${household.nameOf(target)}` };
    return { author: { ownerId: actorId, via: who.device ? 'phone' : 'tablet' } };
  }

  async function writer(c: Context, target: string | null): Promise<Author> {
    const who = await write(c, target);
    return 'author' in who ? who.author : fail(who.status, who.error, who.identify);
  }

  return {
    caller,
    writer,

    async parent(c, denied) {
      const author = await writer(c, null);
      return household.member(author.ownerId)?.parent ? author : fail(403, denied);
    },

    async kiosk(c) {
      const who = await caller(c);
      return who.kiosk ? who : fail(403, 'Réservé à la tablette de la maison');
    },

    async trusted(c) {
      const who = await caller(c);
      return who.kiosk || who.device !== null ? who : fail(403, 'Réservé à la tablette');
    },

    async appliance(c) {
      const who = await caller(c);
      if (who.rejectedToken) return fail(401, REJECTED_PHONE);
      if (who.device) return { ownerId: who.device.ownerId, via: 'phone' };
      if (who.kiosk) return { ownerId: who.actorId ?? null, via: 'tablet' };
      return fail(403, READ_ONLY_DEVICE);
    },
  };
}
