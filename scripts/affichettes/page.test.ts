// Tests de la partie pure des affichettes : adresse de HomeHub, URL du scanner, arguments, page HTML.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE, DEFAULT_PDF, normalizeBase, pageHtml, parseArgs, scannerUrl } from './page.ts';

describe('scannerUrl', () => {
  it('ajoute /m/scanner et le mode à l’adresse de base', () => {
    expect(scannerUrl('https://homehub.example', 'ranger')).toBe('https://homehub.example/m/scanner?mode=ranger');
    expect(scannerUrl('https://homehub.example', 'jete')).toBe('https://homehub.example/m/scanner?mode=jete');
  });
  it('ignore les « / » finaux et les espaces', () => {
    expect(scannerUrl(' https://homehub.example/// ', 'jete')).toBe('https://homehub.example/m/scanner?mode=jete');
  });
  it('garde un port et un sous-dossier', () => {
    expect(scannerUrl('http://192.168.1.20:3000/maison/', 'ranger')).toBe('http://192.168.1.20:3000/maison/m/scanner?mode=ranger');
  });
});

describe('normalizeBase', () => {
  it.each([
    ['homehub.example', 'invalide'],
    ['ftp://homehub.example', 'http(s)'],
    ['javascript:alert(1)', 'http(s)'],
    ['https://homehub.example/?x=1', '« ? »'],
    ['https://homehub.example/#m', '« # »'],
    ['https://alex:secret@homehub.example', 'identifiant'],
  ])('refuse %s', (raw, message) => {
    expect(() => normalizeBase(raw)).toThrow(message);
  });
  it('met l’hôte en minuscules', () => {
    expect(normalizeBase('HTTPS://HomeHub.Example')).toBe('https://homehub.example');
  });
});

describe('parseArgs', () => {
  it('sans argument : adresse fictive et PDF par défaut', () => {
    expect(parseArgs([])).toEqual({ base: DEFAULT_BASE, pdf: DEFAULT_PDF });
  });
  it('lit l’adresse, la sortie et l’aperçu, dans n’importe quel ordre', () => {
    expect(parseArgs(['--sortie', 'a.pdf', 'https://homehub.example/', '--apercu', 'a.png'])).toEqual({
      base: 'https://homehub.example', pdf: 'a.pdf', png: 'a.png',
    });
    expect(parseArgs(['-o', 'b.pdf']).pdf).toBe('b.pdf');
  });
  it('refuse une option inconnue, une valeur manquante, deux adresses', () => {
    expect(() => parseArgs(['--format', 'A5'])).toThrow('inconnue');
    expect(() => parseArgs(['--sortie'])).toThrow('manquante');
    expect(() => parseArgs(['--sortie', '--apercu', 'x.png'])).toThrow('manquante');
    expect(() => parseArgs(['https://a.example', 'https://b.example'])).toThrow('Une seule');
  });
  it('refuse une adresse invalide', () => {
    expect(() => parseArgs(['homehub'])).toThrow('invalide');
  });
});

describe('pageHtml', () => {
  const html = pageHtml('https://homehub.example');
  it('quatre affichettes : deux frigo, deux poubelle', () => {
    expect(html.match(/class="card"/g)).toHaveLength(4);
    expect(html.match(/Frigo · placard/g)).toHaveLength(2);
    expect(html.match(/Poubelle · tri/g)).toHaveLength(2);
    expect(html).toContain('Scanne-moi avec ton téléphone ou dans le <b>scanner HomeHub</b>.');
    expect(html).not.toContain('puis touche');
  });
  it('QR du frigo en mode ranger, QR de la poubelle en mode jete', () => {
    const urls = [...html.matchAll(/data-url="([^"]+)"/g)].map((m) => m[1]);
    expect(urls).toEqual([
      'https://homehub.example/m/scanner?mode=ranger', 'https://homehub.example/m/scanner?mode=jete',
      'https://homehub.example/m/scanner?mode=ranger', 'https://homehub.example/m/scanner?mode=jete',
    ]);
  });
  it('un QR code SVG par affichette, A4 sans marge', () => {
    expect(html.match(/<svg/g)).toHaveLength(4);
    expect(html).toContain('@page { size: A4 portrait; margin: 0; }');
  });
});
