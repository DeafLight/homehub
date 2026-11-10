// Téléphones reliés : la tablette les appaire (QR code) et les retire ; le téléphone demande qui il est. Appairer ou
// retirer : tablette seule, personne reconnue qui a ce droit sur le profil, et le PIN du profil quand il en a un (pour
// retirer : ce PIN ou le code parent). Relier un téléphone donne le droit d'écrire sur son profil : il faut soi-même ce
// droit.
import { z } from 'zod';
import type { Me } from '../shared/types.ts';
import { type Access, REJECTED_PHONE } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { type PinGate, pinInBody } from './pin-gate.ts';
import type { DeviceStore } from './sources/devices.ts';

const pin = z.string().max(20).optional();
const pairingSchema = z.object({ ownerId: z.string(), pin });
const deviceName = z.string().trim().min(1).max(60);
const claimSchema = z.object({ code: z.string().min(1).max(100), name: deviceName, system: z.string().trim().max(40).nullish() });
const renameSchema = z.object({ name: deviceName });

export function createDevicesApi({ household, devices, pins, access }: { household: Household; devices: DeviceStore; pins: PinGate; access: Access }) {
  const api = createRouter();
  const deviceOf = async (id: string) => (await devices.list()).find((d) => d.id === id) ?? fail(404, 'Téléphone inconnu');

  // Téléphone retiré : 401 dès l'ouverture, pas seulement à sa prochaine modification.
  api.get('/me', async (c) => {
    const { kiosk, device, rejectedToken } = await access.caller(c);
    if (rejectedToken) return fail(401, REJECTED_PHONE);
    return c.json<Me>({ kiosk, device });
  });

  /** Profils protégés par un PIN (la tablette le demande avant d'afficher leur QR code), et code parent défini. */
  api.get('/pairing/pins', async (c) => {
    await access.kiosk(c);
    return c.json(await pins.protection());
  });

  api.post('/pairing', async (c) => {
    await access.kiosk(c);
    const input = await readBody(c, pairingSchema, 'Profil inconnu');
    if (!household.isMember(input.ownerId)) return fail(400, 'Profil inconnu');
    await access.writer(c, input.ownerId);
    await pins.owner(input.ownerId, input.pin);
    return c.json(devices.createCode(input.ownerId), 201);
  });

  api.post('/pairing/claim', async (c) => {
    const input = await readBody(c, claimSchema, 'Corps attendu : { "code": "…", "name": "…" }');
    const result = await devices.claim(input.code, input.name, input.system ?? null);
    return result ? c.json(result, 201) : fail(410, 'Code inconnu ou expiré : afficher un nouveau QR code');
  });

  api.get('/devices', async (c) => {
    await access.kiosk(c);
    return c.json(await devices.list());
  });

  /** Nom donné sur la tablette (« Téléphone de Léa ») à la place du modèle annoncé. */
  api.patch('/devices/:id', async (c) => {
    await access.kiosk(c);
    const found = await deviceOf(c.req.param('id'));
    await access.writer(c, found.ownerId);
    const { name } = await readBody(c, renameSchema, 'Nom attendu (60 caractères max)');
    return c.json((await devices.rename(found.id, name)) ?? fail(404, 'Téléphone inconnu'));
  });

  api.delete('/devices/:id', async (c) => {
    await access.kiosk(c);
    const device = await deviceOf(c.req.param('id'));
    await access.writer(c, device.ownerId);
    await pins.ownerOrParent(device.ownerId, await pinInBody(c));
    await devices.remove(device.id);
    return c.body(null, 204);
  });

  return api;
}
