<script lang="ts">
  // Carte « Prochain trajet » de l'accueil du téléphone : quand partir vers le prochain rendez-vous situé (cours ou
  // agenda, dans les 3 h), en bus et tram depuis la position du téléphone, temps réel compris ; pour un parent, la
  // ligne voiture (trafic) et Google Maps. La position est demandée seulement quand un rendez-vous approche, envoyée
  // au serveur pour le calcul, jamais gardée. Rafraîchie toutes les 5 min et quand le téléphone ressort de la poche.
  // Rien sans MOTIS, sans rendez-vous proche ou déjà sur place. Corps du trajet : transit/TripDetails.svelte.
  import { onDestroy } from 'svelte';
  import type { NextTrip } from '../../../../shared/trip.ts';
  import type { Api } from '../../lib/api.ts';
  import { currentPosition } from '../../lib/next-trip.ts';
  import TripDetails from '../transit/TripDetails.svelte';

  type Props = { api: Api; now: Date };
  let { api, now }: Props = $props();

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
    <TripDetails {trip} {now} label="Prochain trajet" />
  </section>
{/if}

<style>
  .trip {
    margin-bottom: 18px;
    padding: 14px 16px;
    border-radius: 18px;
    background: var(--surface);
  }
</style>
