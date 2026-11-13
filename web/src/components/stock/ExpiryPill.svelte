<script lang="ts">
  import { lotLabel, lotTone, shortLotLabel } from '../../../../shared/expiry.ts';
  import type { LotView } from '../../../../shared/types.ts';

  // Pastille de date d'un lot : « DLC passée · hier » en rouge, « DLC lundi 9 · dans 4 j » en jaune, une DDM passée
  // ou une date estimée en gris (pointillés pour l'estimée). `short` : « DLC 7/11 » (scanner, téléphone). Touchable
  // quand `onclick` est donné (corriger la date).
  type Props = { lot: LotView; today: string; short?: boolean; onclick?: () => void };
  let { lot, today, short = false, onclick }: Props = $props();

  const label = $derived(short ? shortLotLabel(lot) : lotLabel(lot, today));
  const tone = $derived(lotTone(lot));
</script>

{#if label}
  {#if onclick}
    <button type="button" class="pill {tone}" class:estimated={lot.estimated} {onclick}>{label}</button>
  {:else}
    <span class="pill {tone}" class:estimated={lot.estimated}>{label}</span>
  {/if}
{/if}

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 0 14px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
    font: inherit;
    font-size: var(--text-small);
    font-weight: 600;
    white-space: nowrap;
  }

  .pill.bad {
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  .pill.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }

  .pill.estimated {
    border: 1px dashed var(--border-strong);
    background: none;
    font-weight: 400;
  }
</style>
