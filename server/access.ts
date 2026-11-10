// Qui appelle l'API : la tablette de la maison (reconnue à sa clé, ou à son adresse), un téléphone appairé (jeton),
// ou un autre appareil du réseau, qui ne peut que lire. Et qui modifie : le profil du téléphone, ou la personne
// reconnue devant la tablette ; un parent partout, un enfant sur son profil seulement. L'adresse du client ne se
// croit sur parole que si elle vient d'un proxy de confiance (`trustedProxies`).
import { createHash, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
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

/** Adresse IP sans le préfixe IPv4 dans IPv6 (`::ffff:192.168.1.5` → `192.168.1.5`), ou undefined si ce n'en est pas une. */
export function normalizeAddress(value: string | undefined): string | undefined {
  const address = value?.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  return address && isIP(address) ? address : undefined;
}

const isLoopback = (address: string) => address === '::1' || address.startsWith('127.');

/** Reconnaît une adresse parmi une liste d'adresses et de plages CIDR (IPv4 ou IPv6). */
export function addressMatcher(entries: readonly string[]): (address: string) => boolean {
  if (entries.length === 0) return () => false;
  const list = new BlockList();
  for (const entry of entries) {
    const [base, prefix] = entry.split('/');
    const type = isIP(base) === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) list.addAddress(base, type);
    else list.addSubnet(base, Number(prefix), type);
  }
  return (address) => list.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * D'où vient la requête. `connection` : l'adresse de la connexion TCP, la seule qu'on ne peut pas inventer.
 * `client` : l'adresse du client ; celle de la connexion, sauf si la connexion vient d'un proxy de confiance, qui la
 * donne dans X-Real-IP (Nginx Proxy Manager) ou X-Forwarded-For. `forwarded` : la requête porte l'un de ces en-têtes.
 */
export type Origin = { connection?: string; client?: string; forwarded: boolean };

/**
 * Ces en-têtes ne valent que ce que vaut celui qui les pose : n'importe qui peut écrire `X-Real-IP: 127.0.0.1`.
 * On ne les lit donc que si la connexion vient d'un proxy déclaré (`trustedProxies`). Dans X-Forwarded-For, chaque
 * proxy ajoute à droite l'adresse qu'il a vue, et le client écrit ce qu'il veut à gauche : on prend la première
 * adresse en partant de la droite qui n'est pas un proxy de confiance.
 */
export function requestOrigin(c: Context, isTrustedProxy: (address: string) => boolean): Origin {
  const realIp = c.req.header('x-real-ip');
  const forwardedFor = c.req.header('x-forwarded-for');
  const forwarded = realIp !== undefined || forwardedFor !== undefined;
  let connection: string | undefined;
  try {
    connection = normalizeAddress(getConnInfo(c).remote.address);
  } catch {
    return { forwarded }; // requête sans connexion (app.request sans environnement)
  }
  if (!connection || !isTrustedProxy(connection)) return { connection, client: connection, forwarded };
  const hops = (forwardedFor ?? '').split(',').map(normalizeAddress).filter((a) => a !== undefined);
  const client = normalizeAddress(realIp) ?? hops.findLast((a) => !isTrustedProxy(a)) ?? hops[0] ?? connection;
  return { connection, client, forwarded };
}

export type KioskRule = {
  /** Adresses de la tablette (`kiosk.addresses`), comparées à l'adresse du client. */
  addresses: readonly string[];
  isKey: (presented: string | undefined) => boolean;
  isTrustedProxy: (address: string) => boolean;
};

/**
 * La tablette : sa clé ; ou une connexion locale directe (développement, captures de la doc, vérification de santé du
 * conteneur), jamais un en-tête qui le prétend ni une requête relayée par un proxy local ; ou une adresse de
 * `kiosk.addresses` (qui peut venir d'un proxy de confiance, mais jamais une adresse locale).
 */
export function isKioskRequest(c: Context, origin: Origin, rule: KioskRule): boolean {
  if (rule.isKey(c.req.header(KIOSK_KEY_HEADER))) return true;
  if (origin.connection !== undefined && isLoopback(origin.connection) && !origin.forwarded) return true;
  return origin.client !== undefined && !isLoopback(origin.client) && rule.addresses.includes(origin.client);
}

export async function identify(c: Context, devices: DeviceStore, rule: KioskRule): Promise<Caller> {
  const kiosk = isKioskRequest(c, requestOrigin(c, rule.isTrustedProxy), rule);
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

  // Les proxys de confiance changent avec la configuration (relue à chaud) : matcher recalculé à chaque révision.
  let proxies = { revision: null as string | null, isTrustedProxy: (_address: string) => false };
  const isTrustedProxy = (address: string) => {
    if (proxies.revision !== config.revision()) {
      proxies = { revision: config.revision(), isTrustedProxy: addressMatcher(config.current().trustedProxies) };
    }
    return proxies.isTrustedProxy(address);
  };

  const caller = async (c: Context) => {
    const who = await identify(c, devices, { addresses: config.current().kiosk.addresses, isKey, isTrustedProxy });
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
