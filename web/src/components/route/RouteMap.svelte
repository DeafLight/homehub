<script lang="ts">
  // Carte MapLibre de l'écran « en route » : fond sombre aux couleurs du thème, tiré du fichier PMTiles d'Angers servi
  // par HomeHub (jamais un fournisseur de tuiles extérieur : les tuiles révèlent le quartier), ou fond uni sans fichier ;
  // tracé du trajet (marche en pointillés, bus et tram en couleur pleine, fait en gris), arrêts de montée, de
  // correspondance et de descente nommés, destination en carré jaune, position en point vert qui pulse, véhicules à
  // prendre en pastille pleine à leur position réelle (avec une pointe dans le sens de marche, si le cap est connu) ou
  // en pastille creuse en pointillés à leur position estimée. « Recentrer » (recenter) suit la position jusqu'au prochain
  // glissement du doigt. Chargé à la demande avec l'écran (maplibre-gl et pmtiles n'alourdissent pas la tablette).
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { AttributionControl, type GeoJSONSource, LngLatBounds, Map as MapLibre, Marker, addProtocol, setWorkerUrl } from 'maplibre-gl';
  // Le worker de MapLibre se cherche à côté du module ; une fois regroupé par Vite, on lui donne son adresse.
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import { FetchSource, PMTiles, Protocol } from 'pmtiles';
  import { onDestroy, onMount } from 'svelte';
  import type { RoutePlace, TripRoute } from '../../../../shared/trip.ts';
  import type { Fix, Step } from '../../lib/en-route.ts';
  import { BASE_SOURCE, buildStyle, type MapColors, readColors, ROUTE_SOURCES, routeLayers } from '../../lib/map-style.ts';
  import { loadPairing } from '../../lib/phone.ts';
  import type { VehicleMark } from '../../lib/vehicle-estimate.ts';

  /** `bottomInset` : hauteur du panneau qui couvre le bas de la carte, en pixels. */
  type Props = { route: TripRoute | null; steps: Step[]; step: number; fix: Fix | null; vehicles: VehicleMark[]; tiles: boolean; bottomInset: number };
  let { route, steps, step, fix, vehicles, tiles, bottomInset }: Props = $props();

  const TILES_PATH = '/api/map/tiles.pmtiles';
  /** Centre d'Angers (ville d'exemple), avant le premier trajet. */
  const START_CENTER: [number, number] = [-0.5517, 47.4736];

  let container: HTMLDivElement;
  let map: MapLibre | null = null;
  let colors: MapColors | null = null;
  let ready = $state(false);
  let follow = false;
  let fitted = false;
  /** La personne a déplacé la carte du doigt : on ne recadre plus de soi-même. */
  let moved = false;
  let baseAdded = false;
  let me: Marker | null = null;
  let places: Marker[] = [];
  let cars: Marker[] = [];

  /** On cadre entre les boutons du haut et le panneau du bas ; les noms des arrêts débordent à droite des points. */
  const padding = () => ({ top: 84, left: 36, right: 130, bottom: Math.round(bottomInset) + 28 });

  function element(className: string, text?: string, label?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `mark ${className}`;
    if (text !== undefined) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.textContent = text;
      el.append(dot);
    }
    if (label) {
      const span = document.createElement('span');
      span.className = 'label';
      span.textContent = label;
      el.append(span);
    }
    return el;
  }

  /** Les tuiles PMTiles passent par la route du serveur, avec le jeton du téléphone. */
  function addBase() {
    if (!map || !colors || baseAdded) return;
    baseAdded = true;
    const url = new URL(TILES_PATH, location.origin).href;
    const pairing = loadPairing();
    const protocol = new Protocol();
    protocol.add(new PMTiles(new FetchSource(url, new Headers(pairing ? { Authorization: `Bearer ${pairing.token}` } : {}))));
    addProtocol('pmtiles', protocol.tile);
    const style = buildStyle(colors, url);
    map.addSource(BASE_SOURCE, style.sources[BASE_SOURCE]);
    // Sous le tracé : avant la première couche du trajet.
    for (const layer of style.layers.slice(1)) map.addLayer(layer, 'fait');
  }

  onMount(() => {
    setWorkerUrl(workerUrl);
    colors = readColors((name) => getComputedStyle(document.documentElement).getPropertyValue(name));
    map = new MapLibre({
      container,
      style: buildStyle(colors, null),
      center: START_CENTER,
      zoom: 13,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    // En haut à droite, sous « Recentrer » : le bas de l'écran est pris par le panneau.
    map.addControl(new AttributionControl({ compact: true }), 'top-right');
    map.on('moveend', () => sides());
    map.on('dragstart', () => {
      follow = false;
      moved = true;
    });
    map.on('load', () => {
      if (!map || !colors) return;
      for (const id of Object.values(ROUTE_SOURCES)) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      for (const layer of routeLayers(colors)) map.addLayer(layer);
      ready = true;
    });
  });

  onDestroy(() => {
    map?.remove();
    map = null;
  });

  const line = (path: [number, number][]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: path } });
  const collection = (paths: [number, number][][]) => ({ type: 'FeatureCollection' as const, features: paths.filter((p) => p.length >= 2).map(line) });

  /** Cadre le trajet, la position et le véhicule à prendre. */
  function fitRoute() {
    if (!map) return;
    const points = steps.flatMap((s) => (s.path.length > 0 ? s.path : [[s.from.lon, s.from.lat] as [number, number], [s.to.lon, s.to.lat] as [number, number]]));
    if (route) points.push([route.destination.lon, route.destination.lat]);
    if (fix) points.push([fix.lon, fix.lat]);
    // Le véhicule à prendre, en approche de son arrêt : on le voit venir.
    for (const v of vehicles) if (!v.current) points.push([v.lon, v.lat]);
    if (points.length === 0) return;
    const bounds = points.reduce((b, p) => b.extend(p), new LngLatBounds(points[0], points[0]));
    map.fitBounds(bounds, { padding: padding(), maxZoom: 16.5, duration: fitted ? 600 : 0 });
    fitted = true;
  }

  /** Recentre sur la position (et la suit), ou sur le trajet sans position. */
  export function recenter() {
    if (!map) return;
    if (fix) {
      follow = true;
      moved = false;
      map.easeTo({ center: [fix.lon, fix.lat], zoom: Math.max(map.getZoom(), 16), padding: padding(), duration: 600 });
    } else fitRoute();
  }

  $effect(() => {
    if (ready && tiles) addBase();
  });

  // Le panneau a changé de hauteur (premier affichage, autre étape) : recadrer, tant qu'on n'a pas touché la carte.
  $effect(() => {
    void bottomInset;
    if (ready && fitted && !moved && !follow) fitRoute();
  });

  // Tracés et arrêts nommés.
  $effect(() => {
    if (!ready || !map) return;
    const done = steps.slice(0, step).map((s) => s.path);
    const walk = steps.slice(step).filter((s) => s.mode === 'walk').map((s) => s.path);
    const ride = steps.slice(step).filter((s) => s.mode !== 'walk').map((s) => s.path);
    (map.getSource(ROUTE_SOURCES.done) as GeoJSONSource | undefined)?.setData(collection(done));
    (map.getSource(ROUTE_SOURCES.walk) as GeoJSONSource | undefined)?.setData(collection(walk));
    (map.getSource(ROUTE_SOURCES.ride) as GeoJSONSource | undefined)?.setData(collection(ride));

    for (const m of places) m.remove();
    places = [];
    const seen = new Set<string>();
    const stop = (p: RoutePlace) => {
      if (seen.has(p.name)) return;
      seen.add(p.name);
      places.push(new Marker({ element: element('stop', '', p.name) }).setLngLat([p.lon, p.lat]).addTo(map!));
    };
    for (const s of steps) if (s.mode !== 'walk') [s.from, s.to].forEach(stop);
    if (route) places.push(new Marker({ element: element('dest', '', route.destination.place) }).setLngLat([route.destination.lon, route.destination.lat]).addTo(map));
    if (!fitted && route) fitRoute();
    sides();
  });

  // Position de la personne : point vert qui pulse (sauf mouvement réduit), suivi après « Recentrer ».
  $effect(() => {
    if (!ready || !map || !fix) return;
    if (!me) me = new Marker({ element: element('me', '') }).setLngLat([fix.lon, fix.lat]).addTo(map);
    else me.setLngLat([fix.lon, fix.lat]);
    if (follow) map.easeTo({ center: [fix.lon, fix.lat], padding: padding(), duration: 500 });
  });

  /** Pastille d'un véhicule : pleine (position réelle) ou creuse (estimée), pointe tournée selon le cap. */
  function vehicleElement(v: VehicleMark): HTMLElement {
    const el = element(`vehicle${v.current ? ' current' : ''}${v.real ? ' real' : ''}`, v.line, v.label);
    if (v.real && v.bearing !== undefined) {
      const heading = document.createElement('span');
      heading.className = 'heading';
      heading.style.transform = `rotate(${Math.round(v.bearing)}deg)`;
      el.querySelector('.dot')?.append(heading);
    }
    return el;
  }

  // Véhicules à prendre : pastille avec la ligne, pleine si la position est réelle.
  $effect(() => {
    if (!ready || !map) return;
    for (const m of cars) m.remove();
    cars = vehicles.map((v) => new Marker({ element: vehicleElement(v) }).setLngLat([v.lon, v.lat]).addTo(map!));
    sides();
  });

  /** Nom à droite du point, ou à gauche dans la moitié droite de l'écran (il déborderait). */
  function sides() {
    if (!map) return;
    const half = container.clientWidth * 0.55;
    for (const m of [...places, ...cars]) m.getElement().classList.toggle('flip', map.project(m.getLngLat()).x > half);
  }
</script>

<div class="map" bind:this={container}></div>

<style>
  .map {
    position: absolute;
    inset: 0;
    background: var(--bg);
  }

  .map :global(.mark) {
    pointer-events: none;
  }

  /* Le point est le marqueur (centré sur sa position) ; le nom se place à côté, à droite ou à gauche (.flip). */
  .map :global(.mark .label) {
    position: absolute;
    top: 50%;
    left: calc(100% + 6px);
    transform: translateY(-50%);
    padding: 2px 8px;
    border-radius: 8px;
    background: var(--surface);
    color: var(--fg);
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 0 0 1px var(--border-strong);
  }

  .map :global(.mark.flip .label) {
    left: auto;
    right: calc(100% + 6px);
  }

  .map :global(.mark .dot) {
    display: block;
  }

  .map :global(.stop .dot) {
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border: 3px solid var(--rain);
    border-radius: 50%;
    background: var(--bg);
  }

  .map :global(.dest .dot) {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background: var(--sun);
    box-shadow: 0 0 0 3px var(--bg);
  }

  .map :global(.me .dot) {
    position: relative;
    width: 18px;
    height: 18px;
    box-sizing: border-box;
    border: 3px solid var(--fg);
    border-radius: 50%;
    background: var(--ok);
  }

  .map :global(.me .dot::after) {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    border: 2px solid var(--ok);
    animation: pulse 2s ease-out infinite;
  }

  .map :global(.vehicle .dot) {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    box-sizing: border-box;
    border: 3px solid var(--rain);
    border-radius: 50%;
    background: transparent;
    color: var(--rain-soft);
    font-size: 0.9rem;
    font-weight: 800;
    /* Creuse : une position estimée, pas une vraie position. */
    border-style: dashed;
  }

  /* Pleine : la vraie position du véhicule (flux temps réel). */
  .map :global(.vehicle.real .dot) {
    position: relative;
    border-style: solid;
    background: var(--rain);
    color: var(--bg);
  }

  /* Pointe dans le sens de marche : un petit triangle au bord de la pastille, tourné autour de son centre. */
  .map :global(.vehicle .heading) {
    position: absolute;
    inset: -9px;
    pointer-events: none;
  }

  .map :global(.vehicle .heading::before) {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-bottom: 6px solid var(--rain);
  }

  .map :global(.vehicle .label) {
    color: var(--rain-soft);
  }

  .map :global(.maplibregl-ctrl-top-right) {
    top: calc(max(12px, env(safe-area-inset-top)) + 52px);
  }

  .map :global(.maplibregl-ctrl-attrib) {
    background: var(--surface);
    color: var(--fg-muted);
  }

  .map :global(.maplibregl-ctrl-attrib a) {
    color: var(--fg-muted);
  }

  @keyframes pulse {
    from {
      transform: scale(1);
      opacity: 0.9;
    }
    to {
      transform: scale(2.6);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .map :global(.me .dot::after) {
      animation: none;
      opacity: 0;
    }
  }
</style>
