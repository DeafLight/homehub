// Relevé du NAS : HomeHub n'a aucun accès au NAS. Une tâche cron (scripts/nas-status.sh de nas-config) écrit toutes
// les 5 minutes un fichier JSON dans le dossier de configuration, monté en lecture seule ; il est relu à chaque
// demande (quelques kilo-octets).
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { NasStatus } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';

const nullableNumber = z.number().nullable();

const nasStatusSchema = z.object({
  schema: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  hostname: z.string().nullable(),
  version: z.string().nullable(),
  uptimeSeconds: nullableNumber,
  bootTime: z.string().nullable(),
  cpu: z.object({ percent: nullableNumber, load1: nullableNumber, temperatureC: nullableNumber }),
  fanRpm: nullableNumber,
  memory: z.object({
    totalBytes: z.number(),
    availableBytes: z.number(),
    swapTotalBytes: z.number(),
    swapUsedBytes: z.number(),
  }),
  battery: z
    .object({ percent: z.number(), status: z.string().nullable(), healthPercent: nullableNumber, onAc: z.boolean() })
    .nullable(),
  pools: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      healthy: z.boolean(),
      sizeBytes: z.number(),
      allocatedBytes: z.number(),
      redundant: z.boolean(),
      lastScrub: z.object({ end: z.string(), errors: nullableNumber }).nullable(),
    }),
  ),
  disks: z.array(z.object({ name: z.string(), model: z.string().nullable(), temperatureC: nullableNumber })),
  checks: z.array(z.object({ level: z.enum(['OK', 'WARN', 'CRIT']), check: z.string(), detail: z.string() })),
  backup: z.object({ at: z.string(), result: z.string() }).nullable(),
  services: z.array(z.object({ label: z.string(), running: z.number(), total: z.number() })).nullable(),
});

export type NasStatusSource = {
  /** Dernier relevé, ou null s'il est absent ou illisible. */
  read(): Promise<NasStatus | null>;
};

export function createNasStatusSource({ path, logger }: { path: string; logger: Logger }): NasStatusSource {
  // Un relevé absent (développement, tâche cron pas encore installée) n'est signalé qu'une fois dans les logs.
  let lastProblem: string | undefined;
  const problem = (message: string) => {
    if (message !== lastProblem) logger.error(`Relevé du NAS (${path}) : ${message}`);
    lastProblem = message;
    return null;
  };

  return {
    async read() {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (err) {
        return problem((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'fichier absent' : (err as Error).message);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return problem('JSON invalide');
      }
      const result = nasStatusSchema.safeParse(raw);
      if (!result.success) return problem(`format inattendu\n${z.prettifyError(result.error)}`);
      lastProblem = undefined;
      const { schema: _schema, ...status } = result.data;
      return status;
    },
  };
}
