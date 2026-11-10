// Tests du fichier JSON du dossier d'état : lecture validée, écritures une par une, mémoire jamais en avance sur le disque.
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createJsonFile } from './json-file.ts';

const schema = z.object({ version: z.literal(1), items: z.array(z.string()) });
type File = z.infer<typeof schema>;

function setup(options: Partial<Parameters<typeof createJsonFile<File>>[0]> = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'homehub-json-')), 'state.json');
  const file = createJsonFile<File>({ path, schema, initial: () => ({ version: 1, items: [] }), ...options });
  return { path, file };
}

describe('createJsonFile', () => {
  it('donne la valeur initiale tant que le fichier n’existe pas, sans rien écrire', async () => {
    const { path, file } = setup();
    expect(await file.read()).toEqual({ version: 1, items: [] });
    expect(existsSync(path)).toBe(false);
  });

  it('écrit chaque modification sur le disque, lisible du seul propriétaire', async () => {
    const { path, file } = setup();
    expect(await file.update((d) => d.items.push('lait'))).toBe(1);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, items: ['lait'] });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('relit un fichier existant et le valide', async () => {
    const { path } = setup();
    writeFileSync(path, JSON.stringify({ version: 1, items: ['pain'] }));
    const file = createJsonFile<File>({ path, schema, initial: () => ({ version: 1, items: [] }) });
    expect((await file.read()).items).toEqual(['pain']);
  });

  it('refuse un fichier qu’il ne comprend pas, sans jamais l’écraser', async () => {
    const { path, file } = setup();
    writeFileSync(path, JSON.stringify({ version: 2 }));
    await expect(file.read()).rejects.toThrow(/illisible/);
    await expect(file.update((d) => d.items.push('x'))).rejects.toThrow(/illisible/);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 2 });
  });

  it('applique les modifications une par une, chacune sur l’état laissé par la précédente', async () => {
    const { file } = setup();
    await Promise.all(['a', 'b', 'c'].map((item) => file.update((d) => d.items.push(item))));
    expect((await file.read()).items).toEqual(['a', 'b', 'c']);
  });

  it('une écriture qui échoue ne change pas la valeur en mémoire, et ne bloque pas la suite', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'homehub-json-')), 'absent', 'state.json');
    const file = createJsonFile<File>({ path, schema, initial: () => ({ version: 1, items: [] }) });
    await expect(file.update((d) => d.items.push('perdu'))).rejects.toThrow();
    expect((await file.read()).items).toEqual([]);
    expect(file.current().items).toEqual([]);
  });

  it('n’écrit rien quand `keep` refuse le résultat', async () => {
    const { path, file } = setup();
    const result = await file.update(
      (d) => {
        d.items.push('refusé');
        return 'non';
      },
      (r) => r === 'oui',
    );
    expect(result).toBe('non');
    expect(existsSync(path)).toBe(false);
    expect((await file.read()).items).toEqual([]);
  });

  it('fait le ménage juste avant chaque écriture', async () => {
    const { file } = setup({ beforeSave: (d) => void (d.items = d.items.slice(-2)) });
    for (const item of ['a', 'b', 'c']) await file.update((d) => d.items.push(item));
    expect((await file.read()).items).toEqual(['b', 'c']);
  });

  it('relit le disque à chaque lecture si demandé (fichier changé par un script)', async () => {
    const { path, file } = setup({ rereadEachTime: true });
    await file.update((d) => d.items.push('a'));
    writeFileSync(path, JSON.stringify({ version: 1, items: ['changé'] }));
    expect((await file.read()).items).toEqual(['changé']);
  });

  it('current() donne la valeur en mémoire, et remplace() la remplace entière', async () => {
    const { file } = setup();
    expect(file.current().items).toEqual([]);
    await file.replace({ version: 1, items: ['neuf'] });
    expect(file.current().items).toEqual(['neuf']);
  });
});
