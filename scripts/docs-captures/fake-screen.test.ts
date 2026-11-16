// Tests de la fausse appli HomeHub TV du monde fictif : mode allumée, en veille ou absente lu dans le dossier d'état,
// compte rendu d'un message vocal comme l'appli (refusé écran éteint, lu, introuvable), réponse rapide demandée
// (fonction 10), maquette du bandeau avec ses réponses, écran de veille du coucher.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_OFF_REASON } from '../../shared/screen.ts';
import { applyRemote, FAKE_SCREEN_MODE_FILE, FAKE_SCREEN_REPLY_FILE, type FakeScreenRemote, fakeScreenTvText, fakeVoiceReport, readFakeScreenMode, readFakeScreenReply } from './fake-screen.ts';

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

  it('réponse rapide demandée : lue si c’est l’une des réponses, sinon rien', () => {
    const dir = mkdtempSync(join(tmpdir(), 'homehub-fake-screen-'));
    expect(readFakeScreenReply(dir)).toBeNull();
    writeFileSync(join(dir, FAKE_SCREEN_REPLY_FILE), JSON.stringify({ reply: 'coming' }));
    expect(readFakeScreenReply(dir)).toBe('coming');
    writeFileSync(join(dir, FAKE_SCREEN_REPLY_FILE), JSON.stringify({ reply: 'peut-être' }));
    expect(readFakeScreenReply(dir)).toBeNull();
  });

  it('maquette du message écrit : les trois réponses seulement quand la télé les propose', () => {
    const base = { title: 'Message d’Alex', text: 'À table !', seconds: 10 };
    expect(fakeScreenTvText({ ...base, replies: true })).toContain('J’arrive');
    expect(fakeScreenTvText(base)).not.toContain('J’arrive');
  });

  it('coucher : écran de veille ouvert puis fermé', () => {
    const state = { screenOn: true, foreground: null, control: 'adb' as const, addresses: [] };
    const remote: FakeScreenRemote = { received: [], screenOn: true, foreground: 'x' };
    expect(applyRemote({ seq: 1, kind: 'bedtime', id: 'a', action: 'sleep' }, state, remote)).toBe('coucher : écran de veille ouvert');
    expect(remote.bedtime).toBe(true);
    applyRemote({ seq: 2, kind: 'bedtime', id: 'b', action: 'wake' }, state, remote);
    expect(remote.bedtime).toBe(false);
  });
});
