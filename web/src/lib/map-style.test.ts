// Tests du style de la carte en route : couleurs lues dans les variables du thème, fond uni sans fichier PMTiles,
// couches du schéma Protomaps sinon, couches du trajet.
import { describe, expect, it } from 'vitest';
import { BASE_SOURCE, buildStyle, OSM, readColors, routeLayers } from './map-style.ts';

const THEME: Record<string, string> = { '--bg': ' #0f1115', '--surface': '#181b22', '--surface-2': '#262a33', '--border-strong': '#3a3f4a', '--fg': '#e8eaed', '--fg-muted': '#9aa1ab', '--rain': '#5b8def', '--ok': '#3fcf7f', '--sun': '#f2b84b' };
const colors = readColors((name) => THEME[name] ?? '');

describe('style de la carte', () => {
  it('lit les couleurs dans les variables CSS', () => {
    expect(colors).toMatchObject({ bg: '#0f1115', rain: '#5b8def', surface2: '#262a33' });
  });

  it('sans fichier : un fond uni, aucune source', () => {
    const style = buildStyle(colors, null);
    expect(style.sources).toEqual({});
    expect(style.layers).toEqual([{ id: 'fond-uni', type: 'background', paint: { 'background-color': '#0f1115' } }]);
    expect(style).not.toHaveProperty('glyphs');
  });

  it('avec le fichier servi par HomeHub : source pmtiles, couches Protomaps sans étiquettes', () => {
    const style = buildStyle(colors, 'http://maison/api/map/tiles.pmtiles');
    expect(style.sources[BASE_SOURCE]).toEqual({ type: 'vector', url: 'pmtiles://http://maison/api/map/tiles.pmtiles', attribution: OSM });
    const layers = style.layers.filter((l) => l.type !== 'background');
    expect(new Set(layers.map((l) => ('source-layer' in l ? l['source-layer'] : '')))).toEqual(new Set(['earth', 'landcover', 'landuse', 'water', 'buildings', 'transit', 'roads']));
    expect(layers.some((l) => l.type === 'symbol')).toBe(false);
    // Toutes les couleurs viennent du thème.
    const used = JSON.stringify(style.layers).match(/#[0-9a-f]{6}/giu) ?? [];
    expect(used.every((c) => Object.values(THEME).map((v) => v.trim()).includes(c))).toBe(true);
  });

  it('trajet : marche en pointillés, courses en couleur pleine', () => {
    const layers = routeLayers(colors);
    const walk = layers.find((l) => l.id === 'marche')!;
    const ride = layers.find((l) => l.id === 'course')!;
    expect(walk.paint).toMatchObject({ 'line-dasharray': [1, 1.6] });
    expect(ride.paint).toMatchObject({ 'line-color': '#5b8def' });
  });
});
