// Applis du lanceur de chaque télé appairée (tiroir de la télécommande du téléphone) : nom, paquet et bannière en PNG,
// envoyés par l'appli HomeHub TV à l'appairage et quand la liste change. Gardées dans screen-apps.json (dossier
// d'état) pour que le tiroir s'affiche même télé éteinte. Rien de personnel : des noms d'applis.
import { z } from 'zod';
import { SCREEN_APPS_MAX, SCREEN_BANNER_MAX, type ScreenApp } from '../../shared/screen.ts';
import { createJsonFile } from './json-file.ts';
import type { Clock } from './types.ts';

/** Paquet Android : segments de lettres, chiffres et « _ » séparés par des points. */
export const PACKAGE_PATTERN = /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/u;

export const screenAppSchema = z.object({
  package: z.string().max(200).regex(PACKAGE_PATTERN, 'paquet Android attendu'),
  name: z.string().trim().min(1).max(60),
  banner: z.string().max(SCREEN_BANNER_MAX).regex(/^[A-Za-z0-9+/]+=*$/u, 'PNG en base64 attendu').nullable(),
});

const fileSchema = z.object({
  version: z.literal(1),
  screens: z.record(z.string(), z.object({ at: z.string(), apps: z.array(screenAppSchema).max(SCREEN_APPS_MAX) })),
});
type AppsFile = z.infer<typeof fileSchema>;

export type ScreenAppList = { at: string; apps: ScreenApp[] };

export type ScreenAppStore = {
  /** Applis de la télé `id`, ou null si elle n'en a pas encore envoyé. */
  get(id: string): Promise<ScreenAppList | null>;
  /** Nouvelle liste (rangée par nom) ; renvoie la date enregistrée. */
  set(id: string, apps: ScreenApp[]): Promise<ScreenAppList>;
  /** Télé retirée : sa liste est oubliée. */
  remove(id: string): Promise<void>;
};

export function createScreenAppStore({ path, clock }: { path: string; clock: Clock }): ScreenAppStore {
  const state = createJsonFile<AppsFile>({ path, schema: fileSchema, initial: () => ({ version: 1, screens: {} }) });
  return {
    async get(id) {
      return (await state.read()).screens[id] ?? null;
    },

    async set(id, apps) {
      // Un paquet une seule fois (sa dernière mention gardée), rangés par nom comme sur le lanceur.
      const unique = [...new Map(apps.map((a) => [a.package, a])).values()];
      const list = { at: clock().toISOString(), apps: unique.sort((a, b) => a.name.localeCompare(b.name, 'fr')).slice(0, SCREEN_APPS_MAX) };
      await state.update((file) => {
        file.screens[id] = list;
      });
      return list;
    },

    async remove(id) {
      await state.update(
        (file) => {
          const had = id in file.screens;
          delete file.screens[id];
          return had;
        },
        (had) => had,
      );
    },
  };
}
