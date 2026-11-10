<script lang="ts">
  import type { SlotProposal } from '../../../../shared/fitness.ts';
  import SportCard from './SportCard.svelte';

  // Changement d'exercice proposé (onglet Sport) : passer à plus dur, à plus doux, ou reprendre l'exercice normal.
  type Props = { proposal: SlotProposal; busy: boolean; onAnswer: (accept: boolean) => void; onOpen: (id: string) => void };
  let { proposal: p, busy, onAnswer, onOpen }: Props = $props();
</script>

<SportCard>
  <p>
    <strong>{p.from.name}</strong> (séance {p.session}) : {p.reason}.
    {p.change === 'normal' ? 'Reprendre' : 'Passer à'} <strong>{p.to.name}</strong> ?
  </p>
  <div class="row">
    <button type="button" class="primary" disabled={busy} onclick={() => onAnswer(true)}>Oui</button>
    <button type="button" disabled={busy} onclick={() => onOpen(p.to.id)}>Voir</button>
    <button type="button" disabled={busy} onclick={() => onAnswer(false)}>Non merci</button>
  </div>
</SportCard>

<style>
  .row {
    display: flex;
    gap: 8px;
  }

  .row button {
    flex: 1;
    min-height: 44px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }

  .row button.primary {
    background: var(--rain);
    color: var(--bg);
  }
</style>
