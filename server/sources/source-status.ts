// État des sources de données (agendas, météo, emplois du temps), d'après leur dernier chargement : affiché sur la
// page « Le NAS » pour voir d'un coup d'œil qu'un agenda ne répond plus, sans lire les logs.
import type { SourceState } from '../../shared/types.ts';
import type { Clock } from './types.ts';

export type SourceStatus = {
  /** Note le résultat d'un chargement : `error` absent si réussi. `name` ne contient jamais de secret. */
  record(name: string, error?: unknown): void;
  /** Sources, celles en échec d'abord, puis par nom. */
  list(): SourceState[];
};

export function createSourceStatus(clock: Clock): SourceStatus {
  const states = new Map<string, SourceState>();
  return {
    record(name, error) {
      const at = clock().toISOString();
      if (error === undefined) {
        states.set(name, { name, ok: true, at });
        return;
      }
      const previous = states.get(name);
      const failingSince = previous && !previous.ok ? (previous.failingSince ?? at) : at;
      const message = error instanceof Error ? error.message : String(error);
      states.set(name, { name, ok: false, at, error: message, failingSince });
    },
    list: () => [...states.values()].sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name, 'fr')),
  };
}
