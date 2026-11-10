<script lang="ts">
  import { FAMILY_LABELS } from '../../../../shared/fitness-catalogue.ts';
  import { type FitnessState, PALIERS, palierHint, type planSession, type SessionNumber, sessionSeconds, WARMUP_MINUTES } from '../../../../shared/fitness.ts';
  import { formatMinutes } from '../../lib/fitness.ts';
  import ExerciseList from './ExerciseList.svelte';
  import SportCard from './SportCard.svelte';

  // Prochaine séance (onglet Sport) : son numéro (une autre au choix), le rythme, les exercices et « Noter la séance ».
  type Props = {
    program: FitnessState;
    session: SessionNumber;
    plan: ReturnType<typeof planSession>;
    onPick: (session: SessionNumber) => void;
    onOpen: (id: string) => void;
    onLog: () => void;
  };
  let { program, session, plan, onPick, onOpen, onLog }: Props = $props();
</script>

{#snippet detail(item: (typeof plan)[number])}
  {FAMILY_LABELS[item.family]}{item.exercise.unit === 's' ? ' · tenir' : ''}{item.exercise.sides ? ' · change de côté à mi-temps' : ''}
  {#if item.normal}· à la place de {item.normal.name}{/if}
  {#if item.stage === 'new'}<span class="new">· nouveau au palier {program.palier}</span>{#if item.before}{` (avant : ${item.before.name})`}{/if}{/if}
  {#if item.stage === 'waiting'}· palier {program.palier} après la prochaine bonne semaine{/if}
{/snippet}

<SportCard>
  <div class="next-head">
    <h2>Séance {session}</h2>
    <div class="pick" role="group" aria-label="Choisir une autre séance">
      {#each [1, 2, 3] as const as n (n)}
        <button type="button" class:on={n === session} aria-pressed={n === session} onclick={() => onPick(n)}>{n}</button>
      {/each}
    </div>
  </div>
  <p class="rhythm">
    Palier {program.palier} · {PALIERS[program.palier].name} · {PALIERS[program.palier].rounds} tours ·
    <strong>{program.effort} s</strong> d’effort / <strong>{program.rest} s</strong> de repos
  </p>
  <p class="muted small">
    {formatMinutes(sessionSeconds(program))}, plus {WARMUP_MINUTES} min d’échauffement ; 1 min de pause entre les tours.
  </p>
  <ExerciseList items={plan} key={(item) => item.family} exercise={(item) => item.exercise} {detail} {onOpen} />
  <button type="button" class="big" onclick={onLog}>Noter la séance</button>
  <p class="hint">{palierHint(program)}</p>
</SportCard>

<style>
  .muted {
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.88rem;
  }

  .next-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .pick {
    display: flex;
    gap: 4px;
  }

  .pick button {
    width: 36px;
    height: 36px;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-weight: 700;
  }

  .pick button.on {
    border-color: var(--fg);
    color: var(--fg);
  }

  .rhythm {
    font-size: 1.05rem;
  }

  .new {
    color: var(--ok-fg);
    font-weight: 600;
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

  .hint {
    margin: 10px 0 0 !important;
    color: var(--ok-fg);
    font-size: 0.95rem;
  }
</style>
