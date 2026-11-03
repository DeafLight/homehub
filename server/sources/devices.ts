// Téléphones appairés. La tablette crée un code à usage unique, valable quelques minutes, pour UN profil
// (montré en QR code) ; le téléphone qui le présente reçoit un jeton lié à ce profil, qu'il ne peut pas changer.
// Seule l'empreinte du jeton est enregistrée (devices.json, dossier d'état) : le fichier ne permet pas de se
// faire passer pour un téléphone.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Device, PairingCode } from '../../shared/types.ts';
import type { Clock } from './types.ts';

export const PAIRING_CODE_TTL_MS = 5 * 60_000;
/** Dernière utilisation d'un téléphone : enregistrée au plus une fois par période. */
const LAST_SEEN_SAVE_MS = 10 * 60_000;

const fileSchema = z.object({
  version: z.literal(1),
  devices: z.array(
    z.object({
      id: z.string(),
      ownerId: z.string(),
      name: z.string(),
      pairedAt: z.string(),
      lastSeenAt: z.string(),
      tokenHash: z.string(),
    }),
  ),
});

type DevicesFile = z.infer<typeof fileSchema>;

export type DeviceStore = {
  list(): Promise<Device[]>;
  /** Nouveau code pour `ownerId` ; il remplace le précédent (un seul QR code affiché à la fois). */
  createCode(ownerId: string): PairingCode;
  /** Échange un code valide contre un jeton (renvoyé une seule fois) ; null si le code est inconnu ou expiré. */
  claim(code: string, name: string): Promise<{ token: string; device: Device } | null>;
  /** Le téléphone qui présente ce jeton, ou null. */
  authenticate(token: string): Promise<Device | null>;
  remove(id: string): Promise<boolean>;
};

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const publicDevice = ({ tokenHash: _tokenHash, ...device }: DevicesFile['devices'][number]): Device => device;

export function createDeviceStore({ path, clock }: { path: string; clock: Clock }): DeviceStore {
  let data: DevicesFile | undefined;
  let pending: PairingCode | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const savedLastSeen = new Map<string, number>();

  async function load(): Promise<DevicesFile> {
    if (data) return data;
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return (data = { version: 1, devices: [] });
    }
    const parsed = fileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`${path} illisible :\n${z.prettifyError(parsed.error)}`);
    return (data = parsed.data);
  }

  function change<T>(apply: (file: DevicesFile) => T): Promise<T> {
    const run = queue.then(async () => {
      const file = await load();
      const result = apply(file);
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
      await rename(tmp, path);
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    async list() {
      return (await load()).devices.map(publicDevice);
    },

    createCode(ownerId) {
      pending = {
        code: randomBytes(16).toString('base64url'),
        ownerId,
        expiresAt: new Date(clock().getTime() + PAIRING_CODE_TTL_MS).toISOString(),
      };
      return pending;
    },

    async claim(code, name) {
      const valid = pending && pending.code === code && new Date(pending.expiresAt) > clock();
      if (!valid || !pending) return null;
      const { ownerId } = pending;
      pending = undefined;
      const token = randomBytes(32).toString('base64url');
      const now = clock().toISOString();
      const stored = { id: randomUUID(), ownerId, name, pairedAt: now, lastSeenAt: now, tokenHash: hash(token) };
      await change((file) => file.devices.push(stored));
      return { token, device: publicDevice(stored) };
    },

    async authenticate(token) {
      const tokenHash = hash(token);
      const found = (await load()).devices.find((d) => d.tokenHash === tokenHash);
      if (!found) return null;
      const now = clock();
      found.lastSeenAt = now.toISOString();
      if (now.getTime() - (savedLastSeen.get(found.id) ?? 0) > LAST_SEEN_SAVE_MS) {
        savedLastSeen.set(found.id, now.getTime());
        await change(() => undefined);
      }
      return publicDevice(found);
    },

    remove(id) {
      return change((file) => {
        const before = file.devices.length;
        file.devices = file.devices.filter((d) => d.id !== id);
        return file.devices.length < before;
      });
    },
  };
}
