// Qui appelle l'API : la tablette de la maison (reconnue à son adresse), un téléphone appairé (jeton), ou un autre
// appareil du réseau, qui ne peut que lire.
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import type { Author, Device } from '../shared/types.ts';
import type { DeviceStore } from './sources/devices.ts';

export type Caller = {
  kiosk: boolean;
  device: Device | null;
  /** Jeton présenté mais refusé (téléphone retiré depuis la tablette). */
  rejectedToken: boolean;
};

const LOOPBACK = new Set(['127.0.0.1', '::1']);

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

export async function identify(c: Context, devices: DeviceStore, kioskAddresses: string[]): Promise<Caller> {
  const address = clientAddress(c);
  const kiosk = address !== undefined && (LOOPBACK.has(address) || kioskAddresses.includes(address));
  const token = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  const device = token ? await devices.authenticate(token) : null;
  return { kiosk, device, rejectedToken: Boolean(token) && !device };
}

/** Auteur d'une modification : le téléphone parle pour son profil ; la tablette, pour le profil ouvert (`by`). */
export function authorOf(caller: Caller, by: string | null | undefined): Author | null {
  if (caller.device) return { ownerId: caller.device.ownerId, via: 'phone' };
  if (caller.kiosk) return { ownerId: by ?? null, via: 'tablet' };
  return null;
}
