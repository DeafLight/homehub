<script lang="ts">
  import type { Commute } from '../../../../shared/types.ts';
  import Icon from '../Icon.svelte';
  import { commuteState } from '../../lib/transit.ts';

  // Trajet du matin, en bandeau sur le dashboard : quand partir de la maison pour attraper le bus (marche comprise).
  // Vert, puis orange la dernière minute, puis « Trop tard » ; recalculé à chaque seconde de l'horloge.
  type Props = { commute: Commute; now: Date };
  let { commute, now }: Props = $props();

  const state = $derived(commuteState(commute, now));
</script>

<section class="commute {state.tone}" aria-live="polite">
  <span class="badge">
    {#if state.leaveIn !== null && state.leaveIn > 1}
      <span class="minutes">{state.leaveIn}</span><span class="unit">min</span>
    {:else}
      <Icon name={state.tone === 'late' ? 'alert' : 'bus'} size={36} />
    {/if}
  </span>
  <span class="text">
    <span class="title">{state.title}</span>
    <span class="detail">{state.detail}</span>
    {#each commute.alerts.slice(0, 1) as alert (alert.id)}
      <span class="alert"><Icon name="alert" size={18} /> {alert.title}</span>
    {/each}
  </span>
</section>

<style>
  .commute {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 16px 24px;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .badge {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 76px;
    height: 76px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg-muted);
  }

  .go .badge {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }

  .hurry .badge,
  .late .badge {
    background: var(--warn-bg);
    color: var(--warn);
  }

  .minutes {
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
  }

  .unit {
    font-size: 0.95rem;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .title {
    font-size: 1.6rem;
    font-weight: 600;
  }

  .hurry .title {
    color: var(--warn);
  }

  .detail {
    font-size: 1.15rem;
    color: var(--fg-muted);
  }

  .alert {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    font-size: 1rem;
    color: var(--warn);
  }
</style>
