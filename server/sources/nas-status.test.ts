import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../testing.ts';
import { createNasStatusSource } from './nas-status.ts';

const fixture = new URL('./fixtures/nas-status.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

describe('relevé du NAS', () => {
  it('lit le fichier écrit par nas-status.sh', async () => {
    const status = await createNasStatusSource({ path: fixture, logger: silentLogger() }).read();
    expect(status?.version).toBe('25.10.7');
    expect(status?.pools[0]).toMatchObject({ name: 'X', redundant: false });
    expect(status?.services).toHaveLength(10);
    expect(status).not.toHaveProperty('schema');
  });

  it('absent ou illisible : null, signalé une seule fois dans les logs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'homehub-nas-'));
    const path = join(dir, 'nas-status.json');
    const logger = silentLogger();
    const source = createNasStatusSource({ path, logger });

    expect(await source.read()).toBeNull();
    expect(await source.read()).toBeNull();
    expect(logger.errors).toEqual([`Relevé du NAS (${path}) : fichier absent`]);

    await writeFile(path, '{ "schema": 2 }');
    expect(await source.read()).toBeNull();
    expect(logger.errors[1]).toMatch(/format inattendu/);
  });
});
