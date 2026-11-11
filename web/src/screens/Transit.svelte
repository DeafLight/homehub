<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { StopChoice, TransitSettings } from '../../../shared/types.ts';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import CommutesCard from '../components/transit/CommutesCard.svelte';
  import HomeStopsCard from '../components/transit/HomeStopsCard.svelte';
  import PlacesCard from '../components/transit/PlacesCard.svelte';
  import '../components/transit/transit.css';
  import { ApiError } from '../lib/api.ts';
  import { createAutoSave, requireParent, type SaveState } from '../lib/autosave.ts';
  import { getAppContext } from '../lib/context.ts';
  import type { PageRoute } from '../lib/route.ts';
  import { nearKey, settingsProblem, toInput } from '../lib/transit-edit.ts';

  // Réglages des transports, ouverts depuis la roue dentée : les lieux de la famille (situés par leur adresse), le
  // trajet de chacun (ligne directe proposée d'après les horaires Irigo, calé sur l'emploi du temps ou sur une plage
  // fixe) et les arrêts de l'accueil. Tout le monde peut regarder ; seul un parent reconnu enregistre.
  // La page garde le brouillon et l'enregistre d'elle-même après chaque modification (lib/autosave.ts) ; chaque carte
  // (components/transit/) le modifie et affiche l'état de l'enregistrement dans son titre.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, actor, profiles } = getAppContext();
  const members = profiles.filter((p) => !p.isFamily);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  let saved = $state<TransitSettings | null>(null);
  let draft = $state<TransitSettings | null>(null);
  let loadError = $state<string | null>(null);
  let saveState = $state<SaveState>({ kind: 'idle' });

  const clone = (s: TransitSettings) => JSON.parse(JSON.stringify(s)) as TransitSettings;
  const dirty = $derived(Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)));

  onMount(async () => {
    try {
      saved = await api.transitSettings();
      draft = clone(saved);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  });

  const auto = createAutoSave({
    problem: () => (draft ? settingsProblem(toInput(draft), nameOf) : null),
    onState: (next) => (saveState = next),
    async save() {
      if (!draft || !dirty) return false;
      await requireParent(actor, 'Seul un parent peut modifier les transports');
      const sent = JSON.stringify(draft);
      try {
        saved = await api.saveTransitSettings(toInput(draft));
      } catch (err) {
        actor.check(err);
        throw new Error(err instanceof ApiError ? err.message : 'Enregistrement impossible');
      }
      // Ce qui a été modifié pendant l'envoi reste dans le brouillon (et repart au prochain enregistrement).
      if (JSON.stringify(draft) === sent) draft = clone(saved);
      return true;
    },
  });
  onDestroy(() => void auto.flush());

  /** Arrêts proches de chaque lieu (nombre affiché, et choix rapide pour l'accueil). */
  let near = $state<Record<string, StopChoice[]>>({});
  async function loadNearCounts() {
    for (const place of draft?.places ?? []) {
      const key = nearKey(place);
      if (near[key]) continue;
      try {
        near[key] = (await api.stopsNear(place)).stops;
      } catch {
        // Horaires indisponibles : pas de compte.
      }
    }
  }
  $effect(() => {
    if (draft) void loadNearCounts();
  });

  /** Revient à ce qui est enregistré (enregistrement refusé). */
  function undo() {
    if (saved) draft = clone(saved);
    auto.reset();
  }
</script>

<div class="transit-page">
  <header>
    <BackButton {back} />
    <h1>Transports</h1>
    <span class="who muted">
      <Icon name="lock" size={22} />
      {#if actor.current?.parent}
        {actor.current.name} peut modifier
      {:else}
        Seul un parent peut modifier
      {/if}
    </span>
  </header>

  {#if loadError}
    <p class="muted">Réglages indisponibles : {loadError}</p>
  {:else if draft}
    <div class="scroll">
      <div class="columns">
        <div class="column">
          <PlacesCard
            bind:draft
            {api}
            {near}
            {saveState}
            onUndo={undo}
            onEdit={() => auto.touch('places')}
            onAddress={loadNearCounts}
            onMessage={(text) => auto.warn('places', text)}
          />
          <HomeStopsCard
            bind:draft
            {api}
            {near}
            {saveState}
            onUndo={undo}
            onEdit={() => auto.touch('stops')}
            onMessage={(text) => auto.warn('stops', text)}
          />
        </div>
        <CommutesCard bind:draft {api} {members} {nameOf} {saveState} onUndo={undo} onEdit={() => auto.touch('commutes')} />
      </div>
      {#if !draft.saved}
        <p class="muted small">Pas encore enregistré : les arrêts et le trajet du fichier de configuration s’appliquent jusque-là.</p>
      {/if}
    </div>

  {/if}
</div>

<style>
  .transit-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 28px 40px 24px;
    box-sizing: border-box;
  }

  header {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  h1 {
    margin: 0;
    font-size: 2.5rem;
    font-weight: 600;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    gap: 18px;
    align-items: start;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
</style>
