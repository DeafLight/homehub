// Tests du découpage d'une page enregistrée (.mhtml) : archive inventée faite à la main (fixtures/recettes), fins de
// ligne CRLF, quoted-printable et base64, jeu de caractères, document principal, fichiers qui n'en sont pas.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeQuotedPrintable, MHTML_MAX_BYTES, MhtmlError, parseMhtml, partAt } from './mhtml.ts';
import { readRecipePage } from './recipe-page.ts';

const fixture = readFileSync(new URL('./fixtures/recettes/page-enregistree.mhtml', import.meta.url));
const bytes = (text: string, encoding: BufferEncoding = 'utf8') => Uint8Array.from(Buffer.from(text, encoding));
const ids = () => {
  let n = 0;
  return () => `m${++n}`;
};

describe('parseMhtml', () => {
  it('retrouve l’adresse et le document principal, décodé (quoted-printable, UTF-8)', () => {
    const page = parseMhtml(fixture);
    expect(page.url).toBe('https://petit-fourneau.example/recettes/clafoutis-cerises');
    expect(page.html).toContain('<title>Clafoutis aux cerises - Le Petit Fourneau</title>');
    expect(page.html).toContain('"3 œufs"');
    expect(page.html).toContain('Préchauffer le four à 180 °C.');
    expect(page.parts.map((p) => p.type)).toEqual(['text/html', 'text/css', 'image/png']);
  });

  it('se lit aussi avec des fins de ligne CRLF', () => {
    const crlf = bytes(fixture.toString('utf8').replace(/\r?\n/gu, '\r\n'));
    const page = parseMhtml(crlf);
    expect(page.html).toContain('"recipeYield":"6 personnes"');
    expect(partAt(page, 'https://petit-fourneau.example/img/clafoutis.png')?.body.byteLength).toBe(70);
  });

  it('le lecteur de recettes lit le document, et l’image se prend dans l’archive', () => {
    const page = parseMhtml(fixture);
    const read = readRecipePage(page.html, page.url!, ids());
    expect(read.found).toBe(true);
    if (!read.found) return;
    expect(read.site).toBe('Le Petit Fourneau');
    expect(read.content).toMatchObject({ title: 'Clafoutis aux cerises', servings: 6, prepMinutes: 15, cookMinutes: 40, totalMinutes: 55 });
    expect(read.content.ingredients.map((l) => l.name)).toEqual(['cerise', 'œuf', 'sucre', 'farine', 'lait']);
    expect(read.content.steps).toHaveLength(3);
    const image = partAt(page, read.imageUrl!);
    expect(image?.type).toBe('image/png');
    expect([...image!.body.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('respecte le jeu de caractères annoncé (latin-1)', () => {
    const mhtml = Buffer.concat([
      Buffer.from('Content-Type: multipart/related; boundary="b"\n\n--b\nContent-Type: text/html; charset=iso-8859-1\nContent-Transfer-Encoding: 8bit\nContent-Location: https://exemple.test/p\n\n<title>', 'latin1'),
      Buffer.from('Crème brûlée', 'latin1'),
      Buffer.from('</title>\n--b--\n', 'latin1'),
    ]);
    expect(parseMhtml(Uint8Array.from(mhtml)).html).toBe('<title>Crème brûlée</title>');
  });

  it('page seule (text/html sans parties), adresse prise dans Content-Location', () => {
    const page = parseMhtml(bytes('Content-Type: text/html; charset=utf-8\nContent-Location: https://exemple.test/r\n\n<h1>Étape 1</h1>'));
    expect(page).toMatchObject({ url: 'https://exemple.test/r', html: '<h1>Étape 1</h1>' });
  });

  it('ignore une adresse qui n’est pas http(s)', () => {
    const page = parseMhtml(bytes('Snapshot-Content-Location: file:///sdcard/x.html\nContent-Type: text/html\n\n<p>x</p>'));
    expect(page.url).toBeNull();
  });

  it('refuse ce qui n’est pas une page enregistrée, ou une archive sans page', () => {
    expect(() => parseMhtml(bytes('%PDF-1.7 …'))).toThrow(MhtmlError);
    expect(() => parseMhtml(bytes('Content-Type: multipart/related; boundary="b"\n\n--b\nContent-Type: image/png\n\nxx\n--b--'))).toThrow('Aucune page dans ce fichier');
    expect(() => parseMhtml(bytes('Content-Type: multipart/related\n\n--b\n'))).toThrow('séparateur');
  });

  it('refuse une archive trop lourde', () => {
    expect(() => parseMhtml(new Uint8Array(MHTML_MAX_BYTES + 1))).toThrow('trop lourde');
  });
});

describe('decodeQuotedPrintable', () => {
  it('décode les octets et recolle les lignes coupées', () => {
    expect(new TextDecoder().decode(decodeQuotedPrintable('cr=C3=A8me =\nbr=C3=BBl=C3=A9e a=3Db'))).toBe('crème brûlée a=b');
  });
});
