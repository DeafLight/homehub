// Tests du magasin des applis des télés : liste rangée par nom, paquet en double, bannière validée, télé retirée,
// liste gardée sur le disque.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createScreenAppStore, screenAppSchema } from './screen-apps.ts';

const clock = () => new Date('2026-11-14T18:00:00.000Z');
const path = () => join(mkdtempSync(join(tmpdir(), 'homehub-screen-apps-')), 'screen-apps.json');

describe('Applis des télés', () => {
  it('rangées par nom, un paquet une seule fois, gardées sur le disque', async () => {
    const file = path();
    const store = createScreenAppStore({ path: file, clock });
    expect(await store.get('tele')).toBeNull();
    await store.set('tele', [
      { package: 'fr.exemple.video', name: 'Vidéo', banner: null },
      { package: 'fr.exemple.box', name: 'Box TV', banner: 'iVBORw0KGgo=' },
      { package: 'fr.exemple.video', name: 'Vidéo+', banner: null },
    ]);
    const again = createScreenAppStore({ path: file, clock });
    expect(await again.get('tele')).toEqual({
      at: '2026-11-14T18:00:00.000Z',
      apps: [
        { package: 'fr.exemple.box', name: 'Box TV', banner: 'iVBORw0KGgo=' },
        { package: 'fr.exemple.video', name: 'Vidéo+', banner: null },
      ],
    });
    await again.remove('tele');
    expect(await again.get('tele')).toBeNull();
  });

  it('paquet et bannière validés', () => {
    expect(screenAppSchema.safeParse({ package: 'com.exemple.app', name: 'App', banner: null }).success).toBe(true);
    expect(screenAppSchema.safeParse({ package: 'pas un paquet', name: 'App', banner: null }).success).toBe(false);
    expect(screenAppSchema.safeParse({ package: 'com.exemple.app', name: 'App', banner: '<svg>' }).success).toBe(false);
  });
});
