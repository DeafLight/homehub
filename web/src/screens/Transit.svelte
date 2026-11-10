<script lang="ts">
  import { onMount } from 'svelte';
  import type { StopChoice, TransitSettings } from '../../../shared/types.ts';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import CommutesCard from '../components/transit/CommutesCard.svelte';
  import HomeStopsCard from '../components/transit/HomeStopsCard.svelte';
  import PlacesCard from '../components/transit/PlacesCard.svelte';
  import '../components/transit/transit.css';
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import type { PageRoute } from '../lib/route.ts';
  import { nearKey, settingsProblem, toInput } from '../lib/transit-edit.ts';

  // Réglages des transports, ouverts depuis la roue dentée : les lieux de la famille (situés par leur adresse), le
  // trajet de chacun (ligne directe proposée d'après les horaires Irigo, calé sur l'emploi du temps ou sur une plage
  // fixe) et les arrêts de l'accueil. Tout le monde peut regarder ; seul un parent reconnu enregistre.
  // La page garde le brouillon et l'enregistre ; chaque carte (components/transit/) le modifie.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, actor, profiles } = getAppContext();
  const members = profiles.filter((p) => !p.isFamily);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  let saved = $state<TransitSettings | null>(null);
  let draft = $state<TransitSettings | null>(null);
  let loadError = $state<string | null>(null);
  let message = $state<{ text: string; ok?: boolean } | null>(null);
  let saving = $state(false);

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

  const edit = () => (message = null);
  const warn = (text: string) => (message = { text });

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

  function cancel() {
    if (saved) draft = clone(saved);
    message = null;
  }

  async function save() {
    if (!draft || saving) return;
    const input = toInput(draft);
    const problem = settingsProblem(input, nameOf);
    if (problem) return void (message = { text: problem });
    if (!(await actor.allow(null))) return;
    if ((await actor.isKiosk()) && !actor.current?.parent) return void (message = { text: 'Seul un parent peut enregistrer les transports' });
    saving = true;
    try {
      saved = await api.saveTransitSettings(input);
      draft = clone(saved);
      message = { text: 'Transports enregistrés', ok: true };
    } catch (err) {
      actor.check(err);
      message = { text: err instanceof ApiError ? err.message : 'Enregistrement impossible' };
    } finally {
      saving = false;
    }
  }
</script>

<div class="transit-page">
  <header>
    <BackButton {back} />
    <h1>Transports</h1>
    <span class="who muted">
      <Icon name="lock" size={22} />
      {#if actor.current?.parent}
        {actor.current.name} peut enregistrer
      {:else}
        Seul un parent peut enregistrer
      {/if}
    </span>
  </header>

  {#if loadError}
    <p class="muted">Réglages indisponibles : {loadError}</p>
  {:else if draft}
    <div class="scroll">
      <div class="columns">
        <div class="column">
          <PlacesCard bind:draft {api} {near} onEdit={edit} onAddress={loadNearCounts} onMessage={warn} />
          <HomeStopsCard bind:draft {api} {near} onEdit={edit} onMessage={warn} />
        </div>
        <CommutesCard bind:draft {api} {members} {nameOf} onEdit={edit} />
      </div>
      {#if !draft.saved}
        <p class="muted small">Pas encore enregistré : les arrêts et le trajet du fichier de configuration s’appliquent jusque-là.</p>
      {/if}
    </div>

    <footer>
      {#if message}
        <span class="message" class:ok={message.ok}>{message.text}</span>
      {/if}
      <span class="actions">
        {#if dirty}
          <button type="button" class="secondary" onclick={cancel}>Annuler</button>
        {/if}
        <button type="button" class="primary" disabled={!dirty || saving} onclick={save}>
          {saving ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}
        </button>
      </span>
    </footer>
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

  footer {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .message {
    font-size: 1.15rem;
    color: var(--danger-fg);
  }

  .message.ok {
    color: var(--ok-fg);
  }

  .actions {
    display: flex;
    gap: 10px;
    margin-left: auto;
  }

  .primary {
    min-height: 56px;
    padding: 0 30px;
    border-radius: 16px;
    background: var(--rain);
    color: #fff;
    font-size: 1.2rem;
    font-weight: 700;
  }
</style>
