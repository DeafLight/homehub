// Tests de la fausse appli HomeHub TV du monde fictif : mode allumée, en veille ou absente lu dans le dossier d'état,
// compte rendu d'un message vocal comme l'appli (refusé écran éteint, lu, introuvable).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_OFF_REASON } from '../../shared/screen.ts';
import { FAKE_SCREEN_MODE_FILE, fakeVoiceReport, readFakeScreenMode } from './fake-screen.ts';

describe('fausse appli HomeHub TV', () => {
  it('mode : allumée sans fichier ou illisible, sinon veille ou absente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'homehub-fake-screen-'));
    expect(readFakeScreenMode(dir)).toBe('allumee');
    for (const mode of ['veille', 'absente', 'allumee'] as const) {
      writeFileSync(join(dir, FAKE_SCREEN_MODE_FILE), JSON.stringify({ mode }));
      expect(readFakeScreenMode(dir)).toBe(mode);
    }
    writeFileSync(join(dir, FAKE_SCREEN_MODE_FILE), '{');
    expect(readFakeScreenMode(dir)).toBe('allumee');
  });

  it('message vocal : refusé écran éteint, comme l’appli', () => {
    expect(fakeVoiceReport(false, 200)).toEqual({ ok: false, reason: SCREEN_OFF_REASON });
    expect(fakeVoiceReport(true, 200)).toEqual({ ok: true });
    expect(fakeVoiceReport(true, 404)).toEqual({ ok: false, reason: 'message introuvable (HTTP 404)' });
  });
});
