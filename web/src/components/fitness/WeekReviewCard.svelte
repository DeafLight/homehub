<script lang="ts">
  import { OPTION_LABELS, PALIERS, type pendingReview } from '../../../../shared/fitness.ts';
  import type { Api } from '../../lib/api.ts';
  import { formatMinutes } from '../../lib/fitness.ts';
  import SportCard from './SportCard.svelte';

  // Bilan de la semaine (onglet Sport) : augmenter ou alléger le rythme, au choix parmi ce que propose le programme.
  type Review = NonNullable<ReturnType<typeof pendingReview>>;
  type Option = Parameters<Api['chooseRhythm']>[1];
  type Props = { review: Review; busy: boolean; onChoose: (option: Option) => void };
  let { review, busy, onChoose }: Props = $props();
</script>

<SportCard highlight>
  <h2>Bilan de la semaine</h2>
  <p>
    {#if review.verdict === 'up'}
      {review.sessions} séances, aucune dure : tu peux augmenter.
    {:else}
      Semaine difficile : tu peux alléger le rythme.
    {/if}
  </p>
  <div class="choices">
    {#each review.choices as c, i (c.option)}
      <button type="button" class:primary={i === 0} disabled={busy} onclick={() => onChoose(c.option)}>
        <span>{c.option === 'next-palier' ? `Palier ${c.rhythm.palier} (${PALIERS[c.rhythm.palier].name})` : OPTION_LABELS[c.option]}</span>
        <span class="small">{c.rhythm.effort} s / {c.rhythm.rest} s · {PALIERS[c.rhythm.palier].rounds} tours · {formatMinutes(c.seconds)}</span>
      </button>
    {/each}
  </div>
</SportCard>

<style>
  .small {
    font-size: 0.88rem;
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .choices button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-height: 56px;
    padding: 8px 14px;
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
    text-align: left;
  }

  .choices button .small {
    font-weight: 400;
    color: var(--fg-muted);
  }

  .choices button.primary {
    border-color: var(--rain);
    background: var(--rain);
    color: var(--bg);
  }

  .choices button.primary .small {
    color: var(--bg);
  }
</style>
