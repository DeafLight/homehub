<script lang="ts">
  // Carte « Prochain trajet » de l'accueil du téléphone : quand partir vers le prochain rendez-vous situé (cours ou
  // agenda, dans les 3 h), en bus et tram depuis la position du téléphone, temps réel compris ; pour un parent, la
  // ligne voiture (trafic) et Google Maps. La position est demandée seulement quand un rendez-vous approche, envoyée
  // au serveur pour le calcul, jamais gardée. Rafraîchie toutes les 5 min et quand le téléphone ressort de la poche.
  // Rien sans MOTIS, sans rendez-vous proche ou déjà sur place. Corps du trajet : transit/TripDetails.svelte. Un toucher
  // ouvre la carte en route (/m/trajet, version 3), sauf sur un lien (Google Maps).
  import { onDestroy } from 'svelte';
  import type { NextTrip } from '../../../../shared/trip.ts';
  import type { Api } from '../../lib/api.ts';
  import { getAppContext } from '../../lib/context.ts';
  import { currentPosition } from '../../lib/next-trip.ts';
  import { PHONE_TRIP_PATH } from '../../lib/route.ts';
  import Icon from '../Icon.svelte';
  import TripDetails from '../transit/TripDetails.svelte';

  type Props = { api: Api; now: Date };
  let { api, now }: Props = $props();
  const { navigate } = getAppContext();

  /** Ouvre la carte en route, sauf quand on touche un lien de la carte. */
  function open(event: Event) {
    if ((event.target as HTMLElement).closest('a')) return;
    navigate(PHONE_TRIP_PATH);
  }

  const REFRESH_MS = 5 * 60_000;
  let trip = $state<NextTrip | null>(null);

  async function load() {
    try {
      const status = await api.tripStatus();
      if (!status.enabled || !status.upcoming) {
        trip = null;
        return;
      }
      trip = (await api.nextTrip(await currentPosition())).trip;
    } catch {
      // Carte accessoire : une panne la laisse telle quelle (ou absente).
    }
  }

  void load();
  const timer = setInterval(load, REFRESH_MS);
  const onVisible = () => document.visibilityState === 'visible' && void load();
  document.addEventListener('visibilitychange', onVisible);
  onDestroy(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });
</script>

{#if trip}
  <section class="trip" aria-label="Prochain trajet">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="body" onclick={open}>
      <TripDetails {trip} {now} label="Prochain trajet" />
    </div>
    <button type="button" class="map" onclick={() => navigate(PHONE_TRIP_PATH)}>
      <Icon name="pin" size={18} /> Voir sur la carte
    </button>
  </section>
{/if}

<style>
  .trip {
    margin-bottom: 18px;
    padding: 14px 16px;
    border-radius: 18px;
    background: var(--surface);
  }

  .body {
    cursor: pointer;
  }

  .map {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    min-height: 44px;
    margin-top: 12px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }
</style>
