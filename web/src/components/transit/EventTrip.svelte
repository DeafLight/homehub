<script lang="ts">
  // Trajet d'un rendez-vous d'agenda touché (agenda du téléphone, semaine et « Cette semaine » de la tablette), dans
  // une feuille qui monte du bas : quand partir pour y être à l'heure (MOTIS, arriveBy), étapes, retard, autre choix,
  // ligne voiture et Google Maps. Le téléphone ne demande sa position que si le rendez-vous commence dans les 3 h ;
  // plus tard, ou sur la tablette, le calcul part de la maison, et l'écran le dit. Le serveur vérifie les droits.
  import type { NextTrip } from '../../../../shared/trip.ts';
  import type { Api } from '../../lib/api.ts';
  import { currentPosition, missingText, needsPosition } from '../../lib/next-trip.ts';
  import BottomSheet from '../phone/BottomSheet.svelte';
  import TripDetails from './TripDetails.svelte';

  /** `key` : clé du rendez-vous ; `title` : son titre, montré pendant le calcul ; `phone` : peut donner sa position. */
  type Props = { api: Api; key: string; title: string; now: Date; phone: boolean; onClose: () => void };
  let { api, key, title, now, phone, onClose }: Props = $props();

  let trip = $state<NextTrip | null>(null);
  let missing = $state<string | null>(null);
  let loading = $state(true);

  async function load(eventKey: string) {
    loading = true;
    trip = null;
    missing = null;
    try {
      const position = phone && needsPosition(eventKey, new Date()) ? await currentPosition() : null;
      const res = await api.eventTrip(eventKey, position);
      trip = res.trip;
      if (!res.trip) missing = missingText(res.missing, res.enabled);
    } catch (err) {
      missing = `Trajet indisponible : ${(err as Error).message}`;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load(key);
  });
</script>

<BottomSheet label="Trajet du rendez-vous" {onClose}>
  <div class="event-trip">
    {#if trip}
      <TripDetails {trip} {now} label="Trajet" />
    {:else}
      <h2 class="card-label">Trajet</h2>
      <p class="title">{title}</p>
      <p class="muted">{loading ? 'Calcul du trajet…' : missing}</p>
    {/if}
    <button type="button" class="btn close" onclick={onClose}>Fermer</button>
  </div>
</BottomSheet>

<style>
  .event-trip {
    display: flex;
    flex-direction: column;
  }

  .title {
    margin: 6px 0 0;
    color: var(--fg-soft);
    font-weight: 600;
  }

  .muted {
    margin: 10px 0 0;
    color: var(--fg-muted);
  }

  .close {
    align-self: stretch;
    margin-top: 18px;
  }
</style>
