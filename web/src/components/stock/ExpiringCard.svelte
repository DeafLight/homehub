<script lang="ts">
  import { onDestroy } from 'svelte';
  import { localDay } from '../../../../shared/dates.ts';
  import { expiringLine } from '../../../../shared/expiry.ts';
  import { getAppContext } from '../../lib/context.ts';
  import { createResource } from '../../lib/resource.svelte.ts';
  import { detailPath } from '../../lib/route.ts';
  import { openStockOn } from '../../lib/stock-opening.ts';
  import Icon from '../Icon.svelte';

  // Carte « À consommer » (accueil de la tablette, dashboard d'un parent) : visible seulement s'il y a une DLC passée
  // ou urgente, deux noms au plus avec la date relative ; touchée, elle ouvre la page Stock sur « À consommer ». Le
  // stock est familial : aucun auteur, aucun profil (les DDM et les dates estimées n'y vont jamais).
  type Props = { compact?: boolean };
  let { compact = false }: Props = $props();

  const { api, clock, navigate, router } = getAppContext();
  const expiring = createResource(() => api.expiring(), 5 * 60_000);
  onDestroy(expiring.destroy);

  const today = $derived(localDay(clock.now));
  const items = $derived(expiring.data?.items ?? []);
  const line = $derived(expiringLine(items, today));
  const urgent = $derived(items.some((i) => i.level === 'urgent'));
  const passed = $derived(items.some((i) => i.level === 'passed'));

  function open() {
    openStockOn('expiring');
    navigate(detailPath('stock', router.route));
  }
</script>

{#if items.length}
  <button type="button" class="expiring" class:compact onclick={open} aria-label="À consommer : ouvrir le stock">
    <span class="text">
      <span class="card-label">À consommer</span>
      <span class="names">
        {#each line.names as n, i (n.name)}
          {#if i > 0}<span class="sep">{' · '}</span>{/if}<span class="name">{n.name}</span>{' '}<span class="when">({n.when})</span>
        {/each}
        {#if line.more}<span class="when"> · et {line.more} autre{line.more > 1 ? 's' : ''}</span>{/if}
      </span>
      {#if !compact}
        <span class="muted">{passed && urgent ? 'DLC passée ou dans les prochains jours' : passed ? 'DLC passée' : 'DLC dans les prochains jours'}</span>
      {/if}
    </span>
    <Icon name="chevron" size={24} color="var(--fg-muted)" strokeWidth={2} />
  </button>
{/if}

<style>
  .expiring {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-3);
    box-sizing: border-box;
    border: 0;
    border-left: 6px solid var(--warn);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    text-align: left;
  }

  .expiring.compact {
    padding: var(--space-2) var(--space-3);
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .card-label {
    color: var(--warn);
  }

  .names {
    font-size: var(--text-body);
  }

  .when,
  .muted {
    color: var(--fg-muted);
  }

  .muted {
    font-size: var(--text-small);
  }
</style>
