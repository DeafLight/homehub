<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { StopChoice, TransitPlace, TransitSettings } from '../../../../shared/types.ts';
  import { type Api, ApiError } from '../../lib/api.ts';
  import { createDebouncer } from '../../lib/debounce.ts';
  import { isTram } from '../../lib/transit.ts';
  import { MAX_HOME_STOPS, nearKey } from '../../lib/transit-edit.ts';
  import Icon from '../Icon.svelte';

  // Carte « Arrêts de l'accueil » de la page Transports : les arrêts affichés à l'accueil, à chercher par leur nom ou
  // parmi ceux proches d'un lieu. Modifie le brouillon de la page ; rien n'est enregistré ici.
  type Props = {
    draft: TransitSettings;
    api: Api;
    /** Arrêts proches de chaque lieu, par coordonnées (`nearKey`). */
    near: Record<string, StopChoice[]>;
    onEdit: () => void;
    onMessage: (text: string) => void;
  };
  let { draft = $bindable(), api, near, onEdit, onMessage }: Props = $props();

  const SEARCH_DELAY_MS = 400;
  const debouncer = createDebouncer(SEARCH_DELAY_MS);
  onDestroy(debouncer.cancel);

  let stopQuery = $state('');
  let stopResults = $state<StopChoice[]>([]);
  let stopError = $state<string | null>(null);
  const searchStops = debouncer.wrap(async () => {
    const q = stopQuery.trim();
    if (q.length < 2) return void (stopResults = []);
    try {
      stopResults = (await api.searchStops(q)).stops;
      stopError = stopResults.length ? null : 'Aucun arrêt trouvé';
    } catch (err) {
      stopError = err instanceof ApiError ? err.message : 'Recherche impossible';
    }
  });

  function showNear(place: TransitPlace) {
    stopQuery = '';
    stopResults = near[nearKey(place)] ?? [];
    stopError = stopResults.length ? null : `Pas d’arrêt près de ${place.label}`;
  }

  function addStop(stop: StopChoice) {
    if (draft.stops.some((s) => s.id === stop.id)) return;
    if (draft.stops.length >= MAX_HOME_STOPS) return onMessage(`${MAX_HOME_STOPS} arrêts au plus à l’accueil`);
    draft.stops.push({ id: stop.id, label: stop.name });
    onEdit();
  }
</script>

{#snippet lines(list: string[])}
  <span class="lines">
    {#each list.slice(0, 6) as line (line)}
      <span class="line" class:tram={isTram(line)}>{line}</span>
    {/each}
  </span>
{/snippet}

<section class="card">
  <h2><Icon name="home" size={28} /> Arrêts de l’accueil <span class="muted small">({MAX_HOME_STOPS} au plus)</span></h2>
  {#each draft.stops as stop, i (stop.id)}
    <div class="row">
      <span class="grow">{stop.label ?? stop.id} <span class="muted small">{stop.id}</span></span>
      <button type="button" class="remove" aria-label="Retirer « {stop.label ?? stop.id} »" onclick={() => (draft.stops.splice(i, 1), onEdit())}><Icon name="close" size={22} /></button>
    </div>
  {:else}
    <p class="muted">Aucun arrêt affiché à l’accueil.</p>
  {/each}
  {#if draft.stops.length < MAX_HOME_STOPS}
    <div class="search">
      <input type="search" placeholder="Roseraie, Ralliement…" aria-label="Chercher un arrêt" bind:value={stopQuery} oninput={searchStops} />
      {#each draft.places as place (place.id)}
        <button type="button" class="secondary" onclick={() => showNear(place)}>Près de {place.label}</button>
      {/each}
    </div>
    {#if stopError}<p class="muted">{stopError}</p>{/if}
    {#each stopResults as stop (stop.id)}
      <button type="button" class="result" disabled={draft.stops.some((s) => s.id === stop.id)} onclick={() => addStop(stop)}>
        <span class="grow">
          {stop.name}
          <span class="muted small">{stop.towards.length ? `vers ${stop.towards.join(', ')}` : ''}{stop.walkMinutes ? ` · ${stop.walkMinutes} min à pied` : ''}</span>
        </span>
        {@render lines(stop.lines)}
      </button>
    {/each}
  {/if}
</section>

<style>
  .lines {
    display: flex;
    gap: 4px;
  }
</style>
