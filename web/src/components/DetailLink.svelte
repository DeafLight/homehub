<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getAppContext } from '../lib/context.ts';
  import { type DetailName, detailPath } from '../lib/route.ts';
  import Icon from './Icon.svelte';

  // Ouvre une page de détail (météo, semaine), qui saura revenir à la page courante.
  // Toute météo affichée y mène, comme tout widget qui montre la prochaine activité.
  // - inline : le contenu garde son style, suivi d'un chevron ;
  // - pill : version compacte sur fond, pour un en-tête ;
  // - block : le bouton épouse le bloc fourni par le parent (sans chevron ajouté : le bloc place le sien).
  type Props = {
    to: DetailName;
    label: string;
    variant?: 'inline' | 'pill' | 'block';
    chevronSize?: number;
    children: Snippet;
  };
  let { to, label, variant = 'inline', chevronSize = 32, children }: Props = $props();

  const { router, navigate } = getAppContext();
</script>

<button class="detail-link {variant}" type="button" aria-label={label} onclick={() => navigate(detailPath(to, router.route))}>
  {@render children()}
  {#if variant !== 'block'}
    <Icon name="chevron" size={chevronSize} color="var(--fg-muted)" strokeWidth={2} />
  {/if}
</button>

<style>
  .detail-link {
    display: inline-flex;
    align-items: center;
    gap: 16px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .inline {
    align-self: flex-start;
    margin: -12px -16px;
    padding: 12px 16px;
    border-radius: var(--radius-md);
  }

  .inline:active {
    background: var(--surface-2);
  }

  .pill {
    gap: 8px;
    min-height: 48px;
    padding: 0 12px 0 16px;
    border-radius: 999px;
    background: var(--surface-2);
  }

  .block {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    border-radius: var(--radius-xl);
  }

  .block:active {
    opacity: 0.8;
  }
</style>
