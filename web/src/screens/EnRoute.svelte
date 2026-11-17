<script lang="ts">
  // Carte en route (chantier « Prochain trajet », version 3), ouverte en touchant la carte « Prochain trajet » de
  // l'accueil du téléphone : la carte plein écran (components/route/RouteMap.svelte) avec la position, le tracé, les
  // arrêts, la destination et le véhicule à prendre, à sa position réelle (version 4 : flux VehiclePositions, redemandé
  // toutes les 20 s pour les seules courses du trajet) ou, à défaut, estimée ; en bas, l'étape en cours, la liste des étapes
  // et le bouton qui passe à la suivante (elle avance aussi d'elle-même d'après la position). Trajet recalculé chaque
  // minute depuis la position tant qu'on n'est pas monté, puis seules les heures des courses suivies ; écran gardé
  // allumé. La position ne sert qu'au calcul (corps de la requête) et à la carte, jamais gardée. Chargé à la demande.
  import { onDestroy, untrack } from 'svelte';
  import type { TripRoute } from '../../../shared/trip.ts';
  import Icon from '../components/Icon.svelte';
  import RouteMap from '../components/route/RouteMap.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { advance, boarded, type Fix, headline, manualNext, mergeRides, nextLabel, type Progress, rideRefs, START, stepRows, stepsOf } from '../lib/en-route.ts';
  import { phonePath } from '../lib/route.ts';
  import { vehiclesToShow, wantedTrips } from '../lib/vehicle-estimate.ts';
  import { track, type TrackedVehicles, VEHICLES_REFRESH_MS } from '../lib/vehicle-real.ts';
  import { createWakeLock } from '../lib/wake-lock.ts';

  const { api, clock, navigate } = getAppContext();

  const REFRESH_MS = 60_000;
  const ICONS = { walk: 'walk', bus: 'bus', tram: 'tram', rail: 'tram', flag: 'flag' } as const;

  let route = $state<TripRoute | null>(null);
  let status = $state<'loading' | 'ready' | 'none' | 'disabled' | 'error'>('loading');
  let progress = $state<Progress>(START);
  let fix = $state<Fix | null>(null);
  let tiles = $state(false);
  let map = $state<RouteMap>();
  let panelHeight = $state(0);
  let tracked = $state<TrackedVehicles>(new Map());

  const steps = $derived(route ? stepsOf(route) : []);
  const now = $derived(clock.now);
  const arrived = $derived(route !== null && steps.length > 0 && progress.step >= steps.length);
  const head = $derived(route ? headline(route, steps, progress, fix, now) : null);
  const rows = $derived(route ? stepRows(route, steps, progress) : []);
  const label = $derived(nextLabel(steps, progress));
  const trips = $derived(wantedTrips(steps, progress.step));
  const vehicles = $derived(vehiclesToShow(steps, progress.step, now, tracked));

  /** Positions réelles des véhicules à montrer ; le flux ne répond pas : on garde les dernières, qui vieillissent. */
  async function loadVehicles() {
    const wanted = trips;
    if (wanted.length === 0) return;
    try {
      const { vehicles: fixes } = await api.tripVehicles(wanted);
      tracked = track(tracked, fixes, clock.now.getTime(), trips);
    } catch {
      // Hors ligne ou serveur muet : positions estimées une fois les réelles trop vieilles.
    }
  }

  // À chaque tic de l'horloge : les positions vieillissent (bascule vers l'estimée au-delà de 2 min).
  $effect(() => {
    const at = now.getTime();
    const wanted = trips;
    tracked = track(untrack(() => tracked), [], at, wanted);
  });

  // Dès que le trajet ou l'étape change les courses à montrer, puis toutes les 20 s.
  let lastTrips = '';
  $effect(() => {
    const key = trips.join(' ');
    if (key !== lastTrips) {
      lastTrips = key;
      void untrack(loadVehicles);
    }
  });
  const vehicleTimer = setInterval(() => void loadVehicles(), VEHICLES_REFRESH_MS);

  async function load() {
    if (arrived) return;
    try {
      if (route && boarded(steps, progress.step)) {
        // Monté : MOTIS ne sait pas qu'on est dans ce tram ; on garde le trajet et on rafraîchit ses heures.
        const refs = rideRefs(steps, progress.step);
        if (refs.length > 0) route = mergeRides(route, (await api.tripRides(refs)).rides);
        return;
      }
      const res = await api.tripRoute(fix && { lat: fix.lat, lon: fix.lon });
      if (!res.enabled) status = 'disabled';
      else if (res.route) {
        route = res.route;
        status = 'ready';
      } else if (!route) status = 'none';
    } catch {
      if (!route) status = 'error';
    }
  }

  const wakeLock = createWakeLock();
  wakeLock.acquire();
  void api.mapInfo().then((info) => (tiles = info.tiles)).catch(() => {});

  // Position suivie tant que la carte est ouverte ; le premier calcul attend la première position (2 s au plus).
  let watchId: number | null = null;
  const firstLoad = setTimeout(() => void load(), 2000);
  let loadedOnce = false;
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        const next: Fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp || Date.now() };
        fix = next;
        if (route) progress = advance(progress, steps, next);
        if (!loadedOnce) {
          loadedOnce = true;
          clearTimeout(firstLoad);
          void load();
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
  }
  const timer = setInterval(load, REFRESH_MS);
  onDestroy(() => {
    clearTimeout(firstLoad);
    clearInterval(timer);
    clearInterval(vehicleTimer);
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    wakeLock.release();
  });

  function next() {
    progress = manualNext(progress, steps);
    void load();
  }
</script>

<div class="screen">
  <RouteMap bind:this={map} {route} {steps} step={progress.step} {fix} {vehicles} {tiles} bottomInset={panelHeight} />

  <div class="top">
    <button type="button" class="pill" onclick={() => navigate(phonePath('shopping'))}><Icon name="back" size={22} strokeWidth={2.4} /> Retour</button>
    <button type="button" class="pill" onclick={() => map?.recenter()}><Icon name="pin" size={20} /> Recentrer</button>
  </div>

  <section class="panel" aria-label="Étape en cours" bind:clientHeight={panelHeight}>
    {#if route && head}
      <div class="head">
        <span class="icon {head.icon}"><Icon name={ICONS[head.icon]} size={28} /></span>
        <div>
          <h1>{head.title}</h1>
          <p class="detail">{head.detail}</p>
        </div>
      </div>
      {#if steps.length === 0}
        <p class="detail">Pas d’itinéraire trouvé en bus ou en tram.</p>
      {/if}
      <ol class="steps">
        {#each rows as row, i (i)}
          <li class="row-{row.state}">
            <span class="time">{row.time}</span>
            <Icon name={ICONS[row.mode]} size={18} />
            <span class="text">{row.text}</span>
            {#if row.delay}<span class="delay">{row.delay}</span>{/if}
          </li>
        {/each}
      </ol>
      <div class="actions">
        {#if label}<button type="button" class="advance" onclick={next}>{label}</button>{/if}
        {#if route.mapsUrl}<a class="maps" href={route.mapsUrl} target="_blank" rel="noopener noreferrer"><Icon name="car" size={20} /> Google Maps</a>{/if}
      </div>
    {:else if status === 'loading'}
      <p class="detail">Calcul du trajet…</p>
    {:else if status === 'disabled'}
      <p class="detail">Les itinéraires ne sont pas configurés (MOTIS).</p>
    {:else if status === 'none'}
      <p class="detail">Pas de rendez-vous situé dans les 3 h, ou tu es déjà sur place.</p>
    {:else}
      <p class="detail">Trajet indisponible pour l’instant. Nouvel essai dans une minute.</p>
    {/if}
  </section>
</div>

<style>
  .screen {
    position: relative;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  .top {
    position: absolute;
    top: max(12px, env(safe-area-inset-top));
    left: 12px;
    right: 12px;
    display: flex;
    justify-content: space-between;
    pointer-events: none;
  }

  .pill {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 16px 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
  }

  .panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 52%;
    overflow-y: auto;
    padding: 18px 18px max(18px, env(safe-area-inset-bottom));
    border-radius: 22px 22px 0 0;
    background: var(--surface);
    box-shadow: 0 -1px 0 var(--border-strong);
  }

  .head {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }

  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: var(--surface-2);
    color: var(--fg);
  }

  .icon.bus,
  .icon.tram,
  .icon.rail {
    background: var(--rain-bg);
    color: var(--rain-soft);
  }

  .icon.flag {
    color: var(--sun);
  }

  h1 {
    margin: 0;
    font-size: 1.3rem;
    line-height: 1.25;
  }

  .detail {
    margin: 4px 0 0;
    color: var(--fg-muted);
    font-size: 1rem;
  }

  .steps {
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }

  .steps li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    color: var(--fg-muted);
    font-size: 0.98rem;
  }

  .steps li.row-current {
    color: var(--fg);
    font-weight: 700;
  }

  .steps li.row-done {
    opacity: 0.5;
  }

  .time {
    width: 4.2em;
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  .delay {
    color: var(--warn);
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }

  .advance {
    flex: 1;
    min-height: 52px;
    border: 0;
    border-radius: 14px;
    background: var(--rain);
    color: var(--bg);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
  }

  .maps {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    color: var(--fg);
    text-decoration: none;
    font-weight: 600;
  }
</style>
