import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOW, silentLogger } from '../testing.ts';
import { createTimerStore } from './timers.ts';

const by = { ownerId: 'alex', via: 'tablet' as const };
const tempPath = () => join(mkdtempSync(join(tmpdir(), 'homehub-timers-')), 'timers.json');

describe('minuteurs enregistrés', () => {
  it('survivent à un redémarrage ; un arrêt est enregistré aussi', () => {
    const path = tempPath();
    let now = NOW.getTime();
    const clock = () => new Date(now);
    const store = createTimerStore({ clock, path });
    const cooking = store.start('Cuisson', 600, by)!;
    const screens = store.start('Écrans', 1800, by)!;
    store.stop(screens.id);

    now += 15 * 60_000; // redémarrage 15 min plus tard : la cuisson est terminée, elle sonne au retour
    const restarted = createTimerStore({ clock, path });
    expect(restarted.list()).toEqual([cooking]);

    now += 40 * 60_000; // oubliée trop longtemps : retirée, et du fichier aussi
    expect(restarted.list()).toEqual([]);
    expect(createTimerStore({ clock, path }).list()).toEqual([]);
  });

  it('fichier illisible : on repart de zéro, en le signalant', () => {
    const path = tempPath();
    writeFileSync(path, '{"version": 2}');
    const logger = silentLogger();
    const store = createTimerStore({ clock: () => NOW, path, logger });
    expect(store.list()).toEqual([]);
    expect(logger.errors.length).toBe(1);
    expect(store.start('Jeux', 60, by)).not.toBeNull();
  });
});
