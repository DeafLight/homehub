<script lang="ts">
  import { FIRST_WAVE, familyList, OPTION_LABELS, PALIERS, type pendingReview, SECOND_WAVE } from '../../../../shared/fitness.ts';
  import type { Api } from '../../lib/api.ts';
  import { formatMinutes } from '../../lib/fitness.ts';
  import SportCard from './SportCard.svelte';

  // Bilan de la semaine passée (onglet Sport) : augmenter ou alléger le rythme, au choix parmi ce que propose le
  // programme. Le palier suivant se fait en deux temps : la carte dit quels exercices passent maintenant, et lesquels
  // au bilan suivant.
  type Review = NonNullable<ReturnType<typeof pendingReview>>;
  type Option = Parameters<Api['chooseRhythm']>[1];
  type Props = { review: Review; busy: boolean; onChoose: (option: Option) => void };
  let { review, busy, onChoose }: Props = $props();
</script>

<SportCard highlight>
  <h2>Bilan de la semaine</h2>
  <p>
    {#if review.verdict === 'up'}
      Bonne semaine ({review.sessions} séances, aucune plus dure qu’« exigeant ») : tu peux augmenter.
    {:else}
      Semaine difficile : tu peux alléger le rythme.
    {/if}
  </p>
  <div class="choices">
    {#each review.choices as c, i (c.option)}
      <button type="button" class:primary={i === 0} disabled={busy} onclick={() => onChoose(c.option)}>
        <span>
          {#if c.option === 'next-palier'}Palier {c.rhythm.palier} ({PALIERS[c.rhythm.palier].name})
          {:else if c.option === 'complete-palier'}Finir le palier {c.rhythm.palier}
          {:else}{OPTION_LABELS[c.option]}{/if}
        </span>
        <span class="small">{c.rhythm.effort} s / {c.rhythm.rest} s · {PALIERS[c.rhythm.palier].rounds} tours · {formatMinutes(c.seconds)}</span>
        {#if c.option === 'next-palier'}
          <span class="small">En deux temps : {familyList(FIRST_WAVE)} passent tout de suite ; {familyList(SECOND_WAVE)} après la bonne semaine suivante.</span>
        {:else if c.option === 'complete-palier'}
          <span class="small">Au même rythme, {familyList(SECOND_WAVE)} passent aussi à la version du palier.</span>
        {/if}
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
