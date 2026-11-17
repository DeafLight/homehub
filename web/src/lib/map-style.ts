// Style MapLibre de la carte en route : fond sombre construit avec les couleurs du thème (variables CSS de app.css,
// lues au moment de construire le style : aucune couleur en dur), sur les couches du schéma Protomaps (terre, eau,
// parcs, bâtiments, rues, voies ferrées) de l'extrait PMTiles servi par HomeHub. Pas de noms de rues : ils demanderaient
// des polices servies à part ; les arrêts, la destination et les véhicules sont nommés par des marqueurs. Sans
// fichier PMTiles, un fond uni. Les couches du trajet (tracés) sont dans routeLayers. Logique pure, testée à part.
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

/** Couleurs du thème utilisées par la carte. */
export type MapColors = { bg: string; surface: string; surface2: string; border: string; fg: string; muted: string; rain: string; ok: string; sun: string };

const VARS: Record<keyof MapColors, string> = {
  bg: '--bg',
  surface: '--surface',
  surface2: '--surface-2',
  border: '--border-strong',
  fg: '--fg',
  muted: '--fg-muted',
  rain: '--rain',
  ok: '--ok',
  sun: '--sun',
};

/** Couleurs lues dans les variables CSS (`read` : getComputedStyle(document.documentElement).getPropertyValue). */
export function readColors(read: (name: string) => string): MapColors {
  return Object.fromEntries(Object.entries(VARS).map(([key, name]) => [key, read(name).trim()])) as MapColors;
}

/** Données du fond : OpenStreetMap, par le build de Protomaps. */
export const OSM = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';

/** Source du fond de carte dans le style. */
export const BASE_SOURCE = 'fond';

/** Couches du fond (schéma Protomaps v4), sans étiquettes. */
function baseLayers(c: MapColors): LayerSpecification[] {
  const src = { source: BASE_SOURCE } as const;
  const width = (base: number, z18: number) => ['interpolate', ['exponential', 1.6], ['zoom'], 12, base, 18, z18] as unknown as number;
  return [
    { id: 'terre', type: 'fill', ...src, 'source-layer': 'earth', paint: { 'fill-color': c.bg } },
    { id: 'verdure', type: 'fill', ...src, 'source-layer': 'landcover', paint: { 'fill-color': c.ok, 'fill-opacity': 0.04 } },
    {
      id: 'parcs',
      type: 'fill',
      ...src,
      'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', ['park', 'garden', 'forest', 'wood', 'grass', 'cemetery', 'nature_reserve', 'pitch', 'playground', 'golf_course', 'meadow']]],
      paint: { 'fill-color': c.ok, 'fill-opacity': 0.07 },
    },
    { id: 'eau', type: 'fill', ...src, 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': c.rain, 'fill-opacity': 0.2 } },
    { id: 'rivieres', type: 'line', ...src, 'source-layer': 'water', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': c.rain, 'line-opacity': 0.3, 'line-width': 1.5 } },
    { id: 'batiments', type: 'fill', ...src, 'source-layer': 'buildings', minzoom: 14, paint: { 'fill-color': c.surface, 'fill-opacity': 0.7 } },
    { id: 'voies-ferrees', type: 'line', ...src, 'source-layer': 'transit', filter: ['==', ['get', 'kind'], 'rail'], paint: { 'line-color': c.muted, 'line-opacity': 0.25, 'line-width': 1 } },
    { id: 'chemins', type: 'line', ...src, 'source-layer': 'roads', minzoom: 14, filter: ['==', ['get', 'kind'], 'path'], paint: { 'line-color': c.surface2, 'line-width': 1, 'line-dasharray': [2, 2] } },
    { id: 'petites-rues', type: 'line', ...src, 'source-layer': 'roads', filter: ['in', ['get', 'kind'], ['literal', ['minor_road', 'other']]], paint: { 'line-color': c.surface2, 'line-width': width(0.6, 9) }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
    { id: 'grandes-rues', type: 'line', ...src, 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'major_road'], paint: { 'line-color': c.border, 'line-width': width(1, 13) }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
    { id: 'voies-rapides', type: 'line', ...src, 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'highway'], paint: { 'line-color': c.border, 'line-width': width(1.4, 16) }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
  ];
}

/** Sources GeoJSON du trajet : marches et courses faites, marches à venir, courses à venir. */
export const ROUTE_SOURCES = { done: 'trajet-fait', walk: 'trajet-marche', ride: 'trajet-course' } as const;

/** Couches du trajet, au-dessus du fond : marche en pointillés clairs, bus et tram en couleur pleine, fait en gris. */
export function routeLayers(c: MapColors): LayerSpecification[] {
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  return [
    { id: 'fait', type: 'line', source: ROUTE_SOURCES.done, layout: round, paint: { 'line-color': c.muted, 'line-opacity': 0.5, 'line-width': 4 } },
    { id: 'course-bord', type: 'line', source: ROUTE_SOURCES.ride, layout: round, paint: { 'line-color': c.bg, 'line-width': 9 } },
    { id: 'course', type: 'line', source: ROUTE_SOURCES.ride, layout: round, paint: { 'line-color': c.rain, 'line-width': 5 } },
    { id: 'marche', type: 'line', source: ROUTE_SOURCES.walk, layout: { 'line-join': 'round' }, paint: { 'line-color': c.fg, 'line-opacity': 0.85, 'line-width': 3, 'line-dasharray': [1, 1.6] } },
  ];
}

/** Style complet : fond uni seul sans fichier PMTiles (`tilesUrl` null), sinon les couches du fond. */
export function buildStyle(c: MapColors, tilesUrl: string | null): StyleSpecification {
  return {
    version: 8,
    sources: tilesUrl ? { [BASE_SOURCE]: { type: 'vector', url: `pmtiles://${tilesUrl}`, attribution: OSM } } : {},
    layers: [{ id: 'fond-uni', type: 'background', paint: { 'background-color': c.bg } }, ...(tilesUrl ? baseLayers(c) : [])],
  };
}
