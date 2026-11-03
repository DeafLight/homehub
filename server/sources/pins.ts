// Codes PIN des profils : demandés par la tablette avant d'afficher le QR code qui relie un téléphone à ce profil.
// Ils sont définis sur le NAS (scripts/set-pin.ts) et enregistrés dans pins.json (dossier d'état) sous forme
// d'empreinte scrypt salée. Le fichier est relu à chaque vérification : un PIN changé par le script s'applique
// sans redémarrer. Après quelques erreurs, le profil est bloqué un moment.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Clock } from './types.ts';

export const PIN_PATTERN = /^\d{4,8}$/;
export const MAX_PIN_FAILURES = 5;
export const PIN_LOCK_MS = 15 * 60_000;

const derive = promisify(scrypt) as (pin: string, salt: Buffer, length: number) => Promise<Buffer>;

const fileSchema = z.object({
  version: z.literal(1),
  pins: z.record(z.string(), z.object({ salt: z.string(), hash: z.string() })),
});

type PinsFile = z.infer<typeof fileSchema>;

export type PinCheck = { ok: true } | { ok: false; reason: 'wrong' } | { ok: false; reason: 'locked'; waitMs: number };

export type PinStore = {
  /** Profils qui ont un PIN. */
  protectedIds(): Promise<string[]>;
  /** Vérifie le PIN de `ownerId` (qui doit en avoir un) ; compte les erreurs et bloque après MAX_PIN_FAILURES. */
  check(ownerId: string, pin: string): Promise<PinCheck>;
  set(ownerId: string, pin: string): Promise<void>;
  remove(ownerId: string): Promise<boolean>;
};

export function createPinStore({ path, clock }: { path: string; clock: Clock }): PinStore {
  const failures = new Map<string, { count: number; lockedUntil?: number }>();

  async function load(): Promise<PinsFile> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return { version: 1, pins: {} };
    }
    const parsed = fileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`${path} illisible :\n${z.prettifyError(parsed.error)}`);
    return parsed.data;
  }

  async function save(file: PinsFile) {
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await rename(tmp, path);
  }

  return {
    async protectedIds() {
      return Object.keys((await load()).pins);
    },

    async check(ownerId, pin) {
      const now = clock().getTime();
      const state = failures.get(ownerId) ?? { count: 0 };
      if (state.lockedUntil !== undefined && state.lockedUntil > now) {
        return { ok: false, reason: 'locked', waitMs: state.lockedUntil - now };
      }
      const stored = (await load()).pins[ownerId];
      if (stored && PIN_PATTERN.test(pin)) {
        const expected = Buffer.from(stored.hash, 'base64');
        const actual = await derive(pin, Buffer.from(stored.salt, 'base64'), expected.length);
        if (timingSafeEqual(actual, expected)) {
          failures.delete(ownerId);
          return { ok: true };
        }
      }
      const count = (state.lockedUntil !== undefined ? 0 : state.count) + 1;
      if (count >= MAX_PIN_FAILURES) {
        failures.set(ownerId, { count, lockedUntil: now + PIN_LOCK_MS });
        return { ok: false, reason: 'locked', waitMs: PIN_LOCK_MS };
      }
      failures.set(ownerId, { count });
      return { ok: false, reason: 'wrong' };
    },

    async set(ownerId, pin) {
      if (!PIN_PATTERN.test(pin)) throw new Error('Le PIN doit faire 4 à 8 chiffres');
      const salt = randomBytes(16);
      const hash = await derive(pin, salt, 32);
      const file = await load();
      file.pins[ownerId] = { salt: salt.toString('base64'), hash: hash.toString('base64') };
      await save(file);
      failures.delete(ownerId);
    },

    async remove(ownerId) {
      const file = await load();
      if (!(ownerId in file.pins)) return false;
      delete file.pins[ownerId];
      await save(file);
      return true;
    },
  };
}
