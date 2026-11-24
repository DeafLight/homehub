import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOW, silentLogger } from '../testing.ts';
import { createTimerStore, RELAUNCH_WINDOW_MS } from './timers.ts';

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

  it('relance : un minuteur qui sonne, ou arrêté en sonnant depuis peu ; pas un minuteur en cours', () => {
    let now = NOW.getTime();
    const path = tempPath();
    const store = createTimerStore({ clock: () => new Date(now), path });
    const pasta = store.start('Cuisson', 60, by)!;
    expect(store.relaunchable(pasta.id)).toBe(false);
    expect(store.relaunch(pasta.id, 120)).toBeNull();

    now += 60_000; // il sonne : relancé tel quel, sous un autre identifiant
    const again = store.relaunch(pasta.id, 120)!;
    expect(again).toMatchObject({ label: 'Cuisson', durationSeconds: 120, startedBy: by });
    expect(again.id).not.toBe(pasta.id);
    expect(store.list()).toEqual([again]);
    expect(createTimerStore({ clock: () => new Date(now), path }).list()).toEqual([again]);

    now += 120_000; // arrêté en sonnant : encore relançable un moment
    store.stop(again.id);
    expect(store.list()).toEqual([]);
    expect(store.relaunchable(again.id)).toBe(true);
    now += RELAUNCH_WINDOW_MS + 1;
    expect(store.relaunchable(again.id)).toBe(false);

    const screens = store.start('Écrans', 600, by)!;
    store.stop(screens.id); // arrêté en cours : pas de relance
    expect(store.relaunchable(screens.id)).toBe(false);
  });
});
