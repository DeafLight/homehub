<script lang="ts">
  import { type Exercise, FAMILY_LABELS } from '../../../../shared/fitness-catalogue.ts';
  import { PALIERS } from '../../../../shared/fitness.ts';
  import { placementOf } from '../../lib/fitness.ts';
  import ExerciseAnimation from './ExerciseAnimation.svelte';
  import MuscleMap from './MuscleMap.svelte';

  // Fiche d'un exercice : animation, comment le faire, muscles travaillés, erreurs fréquentes, versions voisines.
  type Props = { exercise: Exercise; onOpen: (id: string) => void };
  let { exercise, onOpen }: Props = $props();

  const place = $derived(placementOf(exercise));
</script>

<article class="detail">
  <h2>{exercise.name}</h2>
  <p class="meta">
    {FAMILY_LABELS[exercise.family]} · {exercise.unit === 's' ? 'on tient la position' : 'on compte les répétitions'}
    {#if exercise.sides}· change de côté à la moitié de l’effort{/if}
    {#if exercise.equipment === 'elastique'}· élastique de tirage{/if}
    {#if exercise.impact}· avec sauts{/if}
  </p>
  <p class="meta">
    {#each place.places as p, i (i)}{i ? ' · ' : ''}Séance {p.session}, palier {p.palier} ({PALIERS[p.palier].name}){/each}
    {#if place.band}Avec l’élastique de tirage : toutes les séances, palier {place.band} ({PALIERS[place.band].name}){/if}
    {#if place.replaces.length}{place.places.length ? ' · ' : ''}Sans sauts : à la place de {place.replaces.map((e) => e.name).join(', ')}{/if}
    {#if !place.places.length && !place.band && !place.replaces.length}Remplaçant doux, quand un exercice gêne{/if}
  </p>

  {#key exercise.id}
    <div class="animation"><ExerciseAnimation id={exercise.id} label={`Animation : ${exercise.name}`} /></div>
  {/key}

  <h3>Position de départ</h3>
  <p>{exercise.start}</p>
  <h3>Mouvement</h3>
  <p>{exercise.move}</p>
  <h3>Respiration</h3>
  <p>{exercise.breath}</p>

  <h3>Muscles</h3>
  <MuscleMap primary={exercise.primary} secondary={exercise.secondary} />
  <ul class="muscles">
    {#each exercise.primary as m (m)}<li class="primary">{m}</li>{/each}
    {#each exercise.secondary as m (m)}<li>{m}</li>{/each}
  </ul>
  <p class="legend">En plein : muscles principaux ; les autres travaillent aussi.</p>

  <h3>Erreurs fréquentes</h3>
  <ul class="errors">
    {#each exercise.errors as e (e)}<li>{e}</li>{/each}
  </ul>

  <h3>Autres versions</h3>
  <div class="links">
    {#if place.easier}<button type="button" onclick={() => onOpen(place.easier!.id)}>Plus facile : {place.easier.name}</button>{/if}
    {#if place.harder}<button type="button" onclick={() => onOpen(place.harder!.id)}>Plus difficile : {place.harder.name}</button>{/if}
    {#if place.withoutJumps}<button type="button" onclick={() => onOpen(place.withoutJumps!.id)}>Sans sauts : {place.withoutJumps.name}</button>{/if}
    {#if place.gentle}<button type="button" onclick={() => onOpen(place.gentle!.id)}>Si ça gêne : {place.gentle.name}</button>{/if}
  </div>
</article>

<style>
  .detail {
    padding: 4px 2px 12px;
  }

  h2 {
    margin: 0 0 4px;
    font-size: 1.45rem;
  }

  h3 {
    margin: 18px 0 4px;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  p {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.45;
  }

  .animation {
    margin-top: 12px;
  }

  .meta {
    color: var(--fg-muted);
    font-size: 0.95rem;
  }

  .muscles {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }

  .muscles li {
    padding: 4px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    font-size: 0.95rem;
  }

  .muscles li.primary {
    border-color: var(--rain);
    background: var(--rain);
    color: var(--bg);
    font-weight: 600;
  }

  .legend {
    margin-top: 6px;
    color: var(--fg-muted);
    font-size: 0.85rem;
  }

  .errors {
    margin: 0;
    padding-left: 20px;
    font-size: 1.05rem;
    line-height: 1.45;
  }

  .links {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .links button {
    min-height: 46px;
    padding: 0 14px;
    border: 0;
    border-radius: 14px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    text-align: left;
  }
</style>
