// Télés appairées (appli HomeHub TV). La télé demande un code et l'affiche ; un parent le tape sur la tablette ; la
// télé, qui attendait, reçoit son jeton une seule fois. Une télé n'appartient à personne et n'écrit rien : magasin à
// part des téléphones (devices.ts), un jeton de télé n'est jamais reconnu comme téléphone. Seule l'empreinte du jeton
// est enregistrée (screens.json, dossier d'état).
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SCREEN_CODE_ALPHABET, SCREEN_CODE_LENGTH, type Screen, type ScreenPairingStart, type ScreenPairingState } from '../../shared/screen.ts';
import { createJsonFile } from './json-file.ts';
import type { Clock } from './types.ts';

export const SCREEN_CODE_TTL_MS = 5 * 60_000;
/** Demandes d'appairage en attente au plus (les plus anciennes partent). */
export const MAX_PENDING = 5;
export const MAX_SCREENS = 5;
const LAST_SEEN_SAVE_MS = 10 * 60_000;

const fileSchema = z.object({
  version: z.literal(1),
  screens: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      system: z.string().nullable(),
      app: z.string().nullable(),
      pairedAt: z.string(),
      lastSeenAt: z.string(),
      tokenHash: z.string(),
    }),
  ),
});
type ScreensFile = z.infer<typeof fileSchema>;

/** Une télé enregistrée, sans sa présence (que tient le service des télés). */
export type ScreenRecord = Omit<Screen, 'online'>;

type Pending = {
  code: string;
  expiresAt: number;
  system: string | null;
  app: string | null;
  /** Jeton à remettre à la télé, une fois le code tapé sur la tablette. */
  paired?: { token: string; screen: { id: string; name: string } };
  waiters: Set<() => void>;
};

export type ScreenStore = {
  list(): Promise<ScreenRecord[]>;
  /** Nouvelle demande d'appairage, côté télé. */
  startPairing(info: { system: string | null; app: string | null }): ScreenPairingStart;
  /** Le code tapé sur la tablette : la télé est enregistrée sous `name` ; null si le code est inconnu ou expiré. */
  confirm(code: string, name: string): Promise<ScreenRecord | null>;
  /**
   * Où en est la demande `id` ; attend au plus `waitMs` qu'elle soit confirmée. Le jeton n'est donné qu'une fois ;
   * null : demande inconnue ou expirée.
   */
  pairing(id: string, waitMs: number, abort?: AbortSignal): Promise<ScreenPairingState | null>;
  authenticate(token: string): Promise<ScreenRecord | null>;
  rename(id: string, name: string): Promise<ScreenRecord | null>;
  remove(id: string): Promise<boolean>;
};

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Code tel que tapé (minuscules, espaces, tirets) ramené à sa forme affichée. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]+/g, '');

export function createScreenStore({ path, clock }: { path: string; clock: Clock }): ScreenStore {
  const state = createJsonFile<ScreensFile>({ path, schema: fileSchema, initial: () => ({ version: 1, screens: [] }) });
  const pending = new Map<string, Pending>();
  const lastSeen = new Map<string, string>();
  const savedLastSeen = new Map<string, number>();

  const record = ({ tokenHash: _tokenHash, ...screen }: ScreensFile['screens'][number]): ScreenRecord => ({
    ...screen,
    lastSeenAt: lastSeen.get(screen.id) ?? screen.lastSeenAt,
  });

  const sweep = () => {
    const now = clock().getTime();
    for (const [id, p] of pending) {
      if (p.expiresAt <= now) {
        pending.delete(id);
        for (const wake of p.waiters) wake();
      }
    }
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value!);
  };

  const newCode = () => {
    let code: string;
    do {
      code = Array.from({ length: SCREEN_CODE_LENGTH }, () => SCREEN_CODE_ALPHABET[randomInt(SCREEN_CODE_ALPHABET.length)]).join('');
    } while ([...pending.values()].some((p) => p.code === code));
    return code;
  };

  return {
    async list() {
      return (await state.read()).screens.map(record);
    },

    startPairing({ system, app }) {
      sweep();
      const id = randomUUID();
      const expiresAt = clock().getTime() + SCREEN_CODE_TTL_MS;
      const code = newCode();
      pending.set(id, { code, expiresAt, system, app, waiters: new Set() });
      sweep();
      return { id, code, expiresAt: new Date(expiresAt).toISOString() };
    },

    async confirm(code, name) {
      sweep();
      const wanted = normalizeCode(code);
      const entry = [...pending.values()].find((p) => !p.paired && p.code === wanted);
      if (!entry) return null;
      if ((await state.read()).screens.length >= MAX_SCREENS) return null;
      const token = randomBytes(32).toString('base64url');
      const now = clock().toISOString();
      const stored = { id: randomUUID(), name, system: entry.system, app: entry.app, pairedAt: now, lastSeenAt: now, tokenHash: hash(token) };
      await state.update((file) => file.screens.push(stored));
      entry.paired = { token, screen: { id: stored.id, name } };
      for (const wake of entry.waiters) wake();
      entry.waiters.clear();
      return record(stored);
    },

    async pairing(id, waitMs, abort) {
      sweep();
      const entry = pending.get(id);
      if (!entry) return null;
      if (!entry.paired && waitMs > 0 && !abort?.aborted) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            entry.waiters.delete(done);
            abort?.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, waitMs);
          entry.waiters.add(done);
          abort?.addEventListener('abort', done, { once: true });
        });
      }
      if (!pending.has(id)) return null;
      if (!entry.paired) return { status: 'pending' };
      pending.delete(id);
      return { status: 'paired', ...entry.paired };
    },

    async authenticate(token) {
      const tokenHash = hash(token);
      const found = (await state.read()).screens.find((s) => s.tokenHash === tokenHash);
      if (!found) return null;
      const now = clock();
      lastSeen.set(found.id, now.toISOString());
      if (now.getTime() - (savedLastSeen.get(found.id) ?? 0) > LAST_SEEN_SAVE_MS) {
        savedLastSeen.set(found.id, now.getTime());
        await state.update((file) => {
          const saved = file.screens.find((s) => s.id === found.id);
          if (saved) saved.lastSeenAt = now.toISOString();
        });
      }
      return record(found);
    },

    rename(id, name) {
      return state.update((file) => {
        const found = file.screens.find((s) => s.id === id);
        if (found) found.name = name;
        return found ? record(found) : null;
      });
    },

    remove(id) {
      return state.update((file) => {
        const before = file.screens.length;
        file.screens = file.screens.filter((s) => s.id !== id);
        return file.screens.length < before;
      });
    },
  };
}
