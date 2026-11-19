// Tests du dernier chargement de la page de la tablette : rien au départ, noté et relu après redémarrage, horloge de
// la tablette en avance ramenée à celle du serveur, signalement en retard plus ancien ignoré.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTabletPageStore, TABLET_CLOCK_TOLERANCE_MS } from './tablet-page.ts';

const NOW = new Date(2026, 10, 20, 8, 0);

function setup() {
  const path = join(mkdtempSync(join(tmpdir(), 'homehub-tablet-page-')), 'tablet-page.json');
  return { path, store: createTabletPageStore({ path, clock: () => new Date(NOW) }) };
}

describe('Dernier chargement de la page de la tablette', () => {
  it('rien au départ ; noté, puis relu par un nouveau magasin (redémarrage du serveur)', async () => {
    const { path, store } = setup();
    expect(await store.read()).toBeNull();
    const loadedAt = new Date(2026, 10, 20, 3, 2);
    expect(await store.record({ loadedAt, nightly: true })).toEqual({ loadedAt: loadedAt.toISOString(), nightly: true });
    const restarted = createTabletPageStore({ path, clock: () => new Date(NOW) });
    expect(await restarted.read()).toEqual({ loadedAt: loadedAt.toISOString(), nightly: true });
  });

  it("horloge de la tablette trop en avance : l'heure du serveur fait foi", async () => {
    const { store } = setup();
    const ahead = new Date(NOW.getTime() + TABLET_CLOCK_TOLERANCE_MS + 1);
    expect((await store.record({ loadedAt: ahead, nightly: false })).loadedAt).toBe(NOW.toISOString());
    const slightly = new Date(NOW.getTime() + 30_000);
    expect((await store.record({ loadedAt: slightly, nightly: false })).loadedAt).toBe(slightly.toISOString());
  });

  it('un signalement plus ancien que le dernier noté (réessai en retard) ne le remplace pas', async () => {
    const { store } = setup();
    const recent = new Date(2026, 10, 20, 7, 30);
    await store.record({ loadedAt: recent, nightly: false });
    await store.record({ loadedAt: new Date(2026, 10, 20, 3, 2), nightly: true });
    expect(await store.read()).toEqual({ loadedAt: recent.toISOString(), nightly: false });
  });
});
