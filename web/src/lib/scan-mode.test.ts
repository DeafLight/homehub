import { describe, expect, it } from 'vitest';
import { modeSwitchFlash, modeToken, scanModeOfQr, scanReads, tokenMode } from './scan-mode.ts';
import { createReadGate } from './scan-gate.ts';

const ORIGIN = 'https://homehub.example';

describe('QR des affichettes lu par le scanner', () => {
  it('un QR HomeHub vers le scanner avec un mode : ce mode', () => {
    expect(scanModeOfQr(`${ORIGIN}/m/scanner?mode=ranger`, ORIGIN)).toBe('in');
    expect(scanModeOfQr(`${ORIGIN}/m/scanner?mode=jete`, ORIGIN)).toBe('out');
    expect(scanModeOfQr(` ${ORIGIN}/m/scanner/?mode=jete#x `, ORIGIN)).toBe('out');
  });

  it('une autre origine est ignorée, même avec le bon chemin', () => {
    expect(scanModeOfQr('https://ailleurs.example/m/scanner?mode=jete', ORIGIN)).toBeNull();
    expect(scanModeOfQr('http://homehub.example/m/scanner?mode=jete', ORIGIN)).toBeNull();
    expect(scanModeOfQr('https://homehub.example:8443/m/scanner?mode=jete', ORIGIN)).toBeNull();
    expect(scanModeOfQr('https://homehub.example.ailleurs.example/m/scanner?mode=jete', ORIGIN)).toBeNull();
  });

  it('un autre chemin, un mode absent ou inconnu, ou un texte qui n’est pas une adresse : ignoré', () => {
    for (const text of [
      `${ORIGIN}/m/stock?mode=jete`,
      `${ORIGIN}/scanner?mode=jete`,
      `${ORIGIN}/m/scanner`,
      `${ORIGIN}/m/scanner?mode=out`,
      '/m/scanner?mode=jete',
      'WIFI:S:maison;T:WPA;P:secret;;',
      'javascript:alert(1)',
      '',
    ]) {
      expect(scanModeOfQr(text, ORIGIN)).toBeNull();
    }
  });

  it('jetons de mode : jamais confondus avec un code-barres', () => {
    expect(tokenMode(modeToken('in'))).toBe('in');
    expect(tokenMode(modeToken('out'))).toBe('out');
    expect(tokenMode('3017620422003')).toBeNull();
    expect(tokenMode('mode:autre')).toBeNull();
  });

  it('lectures d’une image : codes-barres d’abord, un jeton par mode, QR étrangers écartés', () => {
    const qr = [`${ORIGIN}/m/scanner?mode=jete`, `${ORIGIN}/m/scanner?mode=jete`, 'https://ailleurs.example/'];
    expect(scanReads(['3017620422003'], qr, ORIGIN)).toEqual(['3017620422003', 'mode:out']);
    expect(scanReads([], ['https://ailleurs.example/'], ORIGIN)).toEqual([]);
  });

  it('un QR laissé devant la caméra ne bascule qu’une fois (garde du scanner)', () => {
    const gate = createReadGate(900);
    const reads = scanReads([], [`${ORIGIN}/m/scanner?mode=jete`], ORIGIN);
    expect(gate.frame(reads, 0)).toBe('mode:out');
    expect(gate.frame(reads, 150)).toBeNull();
    expect(gate.frame([], 1200)).toBeNull();
    expect(gate.frame(reads, 1350)).toBe('mode:out');
  });

  it('bandeau de bascule', () => {
    expect(modeSwitchFlash('out').title).toBe('Mode Jeté / épuisé');
    expect(modeSwitchFlash('in').title).toBe('Mode Ranger les courses');
  });
});
