<script lang="ts">
  import { untrack } from 'svelte';
  import type { WeekLog } from '../../../../shared/fitness.ts';
  import { waistPath, weekLogChanged, weekLogInput } from '../../lib/fitness.ts';
  import SportCard from './SportCard.svelte';

  // « Cette semaine » (onglet Sport) : séances faites, cardio et tour de taille à noter (enregistrés au bouton), et la
  // courbe du tour de taille. Les champs partent de ce qui est enregistré à l'ouverture : SportPanel recrée la carte
  // à chaque nouvelle semaine ({#key}), au lieu de recopier le programme dans les champs.
  type Props = {
    /** Ce qui est enregistré pour la semaine (rien encore : undefined). */
    saved: WeekLog | undefined;
    sessions: number;
    waist: { waist: number }[];
    busy: boolean;
    onSave: (log: WeekLog) => void;
  };
  let { saved, sessions, waist, busy, onSave }: Props = $props();

  let cardio = $state<number | null>(untrack(() => saved?.cardio ?? null));
  let waistInput = $state<number | null>(untrack(() => saved?.waist ?? null));
  const dirty = $derived(weekLogChanged(saved, cardio, waistInput));
</script>

<SportCard>
  <h2>Cette semaine</h2>
  <p class="muted">{sessions} séance{sessions > 1 ? 's' : ''} sur 3</p>
  <div class="week">
    <label>Cardio <input type="number" inputmode="numeric" min="0" max="5000" bind:value={cardio} placeholder="—" /> min</label>
    <label>Tour de taille <input type="number" inputmode="decimal" min="30" max="250" step="0.5" bind:value={waistInput} placeholder="—" /> cm</label>
  </div>
  {#if dirty}<button type="button" class="big" disabled={busy} onclick={() => onSave(weekLogInput(cardio, waistInput))}>Enregistrer</button>{/if}
  {#if waist.length >= 2}
    <svg class="chart" viewBox="0 0 300 80" role="img" aria-label="Tour de taille au fil des semaines">
      <polyline points={waistPath(waist)} fill="none" stroke="var(--rain)" stroke-width="2.5" stroke-linejoin="round" />
    </svg>
    <p class="muted small">
      Tour de taille : {waist[0].waist} cm → {waist.at(-1)?.waist} cm ({waist.length} semaines)
    </p>
  {/if}
</SportCard>

<style>
  .muted {
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.88rem;
  }

  .big {
    width: 100%;
    min-height: 54px;
    border: 0;
    border-radius: 999px;
    background: var(--rain);
    color: var(--bg);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
  }

  .week {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    margin-bottom: 10px;
  }

  .week label {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .week input {
    width: 4.5em;
    min-height: 42px;
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 1.05rem;
    text-align: right;
  }

  .chart {
    display: block;
    width: 100%;
    height: auto;
    margin-top: 10px;
  }
</style>
