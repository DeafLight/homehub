<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getAppContext } from '../lib/context.ts';
  import { weatherPath } from '../lib/route.ts';
  import Icon from './Icon.svelte';

  // Toute météo affichée ouvre la page détaillée, qui saura revenir à la page courante.
  // `pill` : version compacte sur fond, pour un en-tête ; sinon le bloc garde son propre style.
  type Props = { pill?: boolean; chevronSize?: number; children: Snippet };
  let { pill = false, chevronSize = 32, children }: Props = $props();

  const { router, navigate } = getAppContext();
</script>

<button class="weather-link" class:pill type="button" aria-label="Météo détaillée" onclick={() => navigate(weatherPath(router.route))}>
  {@render children()}
  <Icon name="chevron" size={chevronSize} color="var(--fg-muted)" strokeWidth={2} />
</button>

<style>
  .weather-link {
    display: inline-flex;
    align-items: center;
    gap: 16px;
    align-self: flex-start;
    margin: -12px -16px;
    padding: 12px 16px;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .weather-link:active {
    background: var(--surface-2);
  }

  .pill {
    gap: 8px;
    margin: 0;
    min-height: 48px;
    padding: 0 12px 0 16px;
    border-radius: 999px;
    background: var(--surface-2);
  }
</style>
