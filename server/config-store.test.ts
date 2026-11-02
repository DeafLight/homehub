import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from './config.ts';
import { configRevision, createConfigStore, reloadConfig } from './config-store.ts';
import { testConfig } from './testing.ts';

const tom = parseConfig({ members: [{ id: 'tom', name: 'Tom', color: '#d96aa7' }] });

describe('createConfigStore', () => {
  it('change de révision seulement si la configuration change', () => {
    const store = createConfigStore(testConfig);
    const initial = store.revision();

    expect(store.set(structuredClone(testConfig))).toBe(false);
    expect(store.revision()).toBe(initial);

    expect(store.set(tom)).toBe(true);
    expect(store.revision()).toBe(configRevision(tom));
    expect(store.current()).toBe(tom);
  });
});

describe('reloadConfig', () => {
  const logger = () => ({ log: vi.fn(), error: vi.fn() });

  async function yamlFile(content: string) {
    const path = join(await mkdtemp(join(tmpdir(), 'homehub-config-')), 'homehub.yaml');
    await writeFile(path, content);
    return path;
  }

  it('applique un fichier valide', async () => {
    const store = createConfigStore(testConfig);
    const log = logger();
    const path = await yamlFile('members:\n  - id: tom\n    name: Tom\n    color: "#d96aa7"\n');

    expect(await reloadConfig(path, store, log)).toBe(true);
    expect(store.current().members.map((m) => m.id)).toEqual(['tom']);
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('1 membres'));
  });

  it('garde la configuration précédente si le fichier est invalide', async () => {
    const store = createConfigStore(testConfig);
    const log = logger();
    const path = await yamlFile('members:\n  - id: Tom\n    name: Tom\n    color: rouge\n');

    expect(await reloadConfig(path, store, log)).toBe(false);
    expect(store.current()).toBe(testConfig);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Configuration précédente conservée'));
  });

  it('garde la configuration précédente si le fichier a disparu', async () => {
    const store = createConfigStore(testConfig);
    expect(await reloadConfig('config/absent.yaml', store, logger())).toBe(false);
    expect(store.current()).toBe(testConfig);
  });
});
