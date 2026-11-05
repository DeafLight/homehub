import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GTFS_FILES, NOW, silentLogger, zip } from '../testing.ts';
import { buildGtfsIndex, createGtfsSource, distanceMeters, parseCsv, unzip, walkMinutes } from './gtfs.ts';

const HOME = { lat: 47.47, lon: -0.55 };
const SCHOOL = { lat: 47.48, lon: -0.55 };

describe('GTFS', () => {
  const index = buildGtfsIndex(unzip(zip(GTFS_FILES)));

  it('lit une archive zip et des CSV avec guillemets', () => {
    expect(parseCsv('a,b\n"x, ""y""",z\r\n')).toEqual([{ a: 'x, "y"', b: 'z' }]);
    expect(index.stop('GARE')?.name).toBe('Gare, parvis');
  });

  it('donne lignes et destinations de chaque quai, et les arrêts proches avec la marche estimée', () => {
    expect(index.stop('1MAIR')).toMatchObject({ lines: ['3', 'A'], towards: ['Belle-Beille', 'Loin'] });
    expect(index.stop('2MAIR')).toMatchObject({ lines: [], towards: [] }); // terminus : on n'y monte pas
    expect(index.nearby(HOME).map((s) => [s.id, s.walkMinutes])).toEqual([['1MAIR', 1], ['GARE', 10]]);
    expect(walkMinutes(250)).toBe(5); // 250 m + 30 % = 325 m, à 75 m/min
    expect(Math.round(distanceMeters(HOME, SCHOOL))).toBe(1112);
    expect(index.search('lycee').map((s) => s.id)).toEqual(['1LYC']);
  });

  it('trouve les lignes directes, une par ligne, avec durée et sens', () => {
    expect(index.routes(HOME, SCHOOL)).toEqual([
      {
        line: 'A',
        origin: '1MAIR',
        originName: 'Mairie',
        destination: '1LYC',
        destinationName: 'Lycée',
        towards: 'Belle-Beille',
        headsigns: ['Belle-Beille'],
        oneWay: true,
        rideMinutes: 12,
        walkFrom: 1,
        walkTo: 1,
        totalMinutes: 14,
      },
    ]);
  });

  it('donne les courses du jour, selon le calendrier et ses exceptions', () => {
    const route = { line: 'A', origin: '1MAIR', destination: '1LYC' };
    const thursday = index.trips(route, new Date(2026, 10, 5));
    expect(thursday.map((t) => [t.departs.getHours(), t.departs.getMinutes(), t.arrives.getMinutes()])).toEqual([
      [7, 40, 52],
      [8, 0, 12],
      [8, 20, 32],
    ]);
    expect(index.trips(route, new Date(2026, 10, 11)).map((t) => t.departs.getHours())).toEqual([9]); // férié
  });

  it('télécharge l’archive, la garde, et la relit au démarrage suivant sans télécharger', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'homehub-gtfs-')), 'irigo-gtfs.zip');
    let downloads = 0;
    const fetchFn = (async () => {
      downloads++;
      return new Response(new Uint8Array(zip(GTFS_FILES)));
    }) as unknown as typeof fetch;
    const first = createGtfsSource({ path, clock: () => NOW, logger: silentLogger(), fetchFn });
    expect((await first.index())?.stop('1LYC')?.name).toBe('Lycée');
    const second = createGtfsSource({ path, clock: () => new Date(Date.now()), logger: silentLogger(), fetchFn });
    expect((await second.index())?.stop('1LYC')?.name).toBe('Lycée');
    expect(downloads).toBe(1);
  });

  it('sans archive ni réseau : pas d’horaires (et un message)', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'homehub-gtfs-')), 'irigo-gtfs.zip');
    const fetchFn = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    expect(await createGtfsSource({ path, clock: () => NOW, logger: silentLogger(), fetchFn }).index()).toBeNull();
  });
});
