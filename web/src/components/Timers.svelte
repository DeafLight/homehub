<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { isPhoneRoute } from '../lib/route.ts';
  import { formatCountdown, formatDuration, secondsLeft, TIMER_LABELS, TIMER_PRESETS, timerName } from '../lib/timers.ts';

  // Minuteurs sur la tablette : ceux en cours, en bas de l'écran (toucher : l'arrêter) ; celui qui se termine prend
  // tout l'écran, par-dessus la veille, et sonne jusqu'à « Arrêter » ; la fenêtre « Minuteur » en lance un.
  const REFRESH_MS = 5_000;
  const BEEP_EVERY_MS = 1_500;
  /** Au-delà, la sonnerie se tait (l'alerte reste affichée). */
  const RING_MAX_MS = 2 * 60_000;

  const { actor, clock, router, timers } = getAppContext();

  let kiosk = $state(false);
  let label = $state('');

  onMount(() => {
    void actor.isKiosk().then((value) => (kiosk = value));
  });

  const enabled = $derived(kiosk && !isPhoneRoute(router.route));
  const running = $derived(timers.list.filter((t) => secondsLeft(t, clock.now) > 0));
  const ringing = $derived(timers.list.filter((t) => secondsLeft(t, clock.now) === 0));
  /** Change seulement quand un minuteur se met à sonner ou s'arrête (pas à chaque seconde). */
  const ringingIds = $derived(ringing.map((t) => t.id).join(','));

  $effect(() => {
    if (!enabled) return;
    void timers.refresh();
    const timer = setInterval(() => void timers.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  });

  // Sonnerie : trois bips, répétés, tant qu'un minuteur sonne (au plus RING_MAX_MS après la fin du plus récent).
  let audio: AudioContext | null = null;
  function beep() {
    try {
      audio ??= new AudioContext();
      void audio.resume();
      for (let i = 0; i < 3; i++) {
        const start = audio.currentTime + i * 0.25;
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
        osc.connect(gain).connect(audio.destination);
        osc.start(start);
        osc.stop(start + 0.2);
      }
    } catch {
      // pas de son possible : l'alerte à l'écran suffit
    }
  }

  $effect(() => {
    if (!enabled || !ringingIds) return;
    const latest = untrack(() => Math.max(...ringing.map((t) => new Date(t.endsAt).getTime())));
    beep();
    const timer = setInterval(() => (Date.now() - latest < RING_MAX_MS ? beep() : clearInterval(timer)), BEEP_EVERY_MS);
    return () => clearInterval(timer);
  });

  async function start(minutes: number) {
    if (await timers.start(label, minutes * 60)) {
      timers.dialog = false;
      label = '';
    }
  }
</script>

{#if enabled}
  {#if running.length && !timers.dialog}
    <div class="running" aria-label="Minuteurs en cours">
      {#each running as timer (timer.id)}
        <button type="button" class="pill" aria-label="Arrêter le minuteur {timerName(timer)}" onclick={() => timers.stop(timer.id)}>
          <Icon name="timer" size={24} />
          <span class="name">{timerName(timer)}</span>
          <span class="left">{formatCountdown(secondsLeft(timer, clock.now))}</span>
          <Icon name="close" size={20} color="var(--fg-muted)" />
        </button>
      {/each}
    </div>
  {/if}

  {#if timers.dialog}
    <div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (timers.dialog = false)}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Minuteur">
        <header>
          <h2>Minuteur</h2>
          <button type="button" class="icon" aria-label="Fermer" onclick={() => (timers.dialog = false)}><Icon name="close" size={28} /></button>
        </header>
        <div class="labels" role="radiogroup" aria-label="Pour quoi ?">
          {#each TIMER_LABELS as name (name)}
            <button type="button" role="radio" aria-checked={label === name} class:selected={label === name} onclick={() => (label = label === name ? '' : name)}>
              {name}
            </button>
          {/each}
        </div>
        <div class="presets">
          {#each TIMER_PRESETS as minutes (minutes)}
            <button type="button" onclick={() => start(minutes)}>{formatDuration(minutes)}</button>
          {/each}
        </div>
        {#if running.length}
          <ul class="list">
            {#each running as timer (timer.id)}
              <li>
                <span>{timerName(timer)}</span>
                <span class="left">{formatCountdown(secondsLeft(timer, clock.now))}</span>
                <button type="button" class="secondary" onclick={() => timers.stop(timer.id)}>Arrêter</button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}

  {#if ringing.length}
    <div class="ringing" role="alertdialog" aria-label="Minuteur terminé">
      {#each ringing as timer (timer.id)}
        <div class="alarm">
          <Icon name="timer" size={96} color="var(--sun)" />
          <p class="title">{timerName(timer)}</p>
          <p class="muted">
            C'est l'heure !{#if timer.durationSeconds >= 60}{` (${formatDuration(Math.round(timer.durationSeconds / 60))})`}{/if}
          </p>
          <button type="button" class="stop" onclick={() => timers.stop(timer.id)}>Arrêter</button>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .running {
    position: fixed;
    left: 50%;
    bottom: 16px;
    z-index: 30;
    transform: translateX(-50%);
    display: flex;
    gap: 12px;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 16px 0 18px;
    border: 2px solid var(--sun);
    border-radius: 999px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-size: 1.2rem;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.4);
  }

  .name {
    font-weight: 600;
  }

  .left {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 60%);
  }

  .dialog {
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    box-sizing: border-box;
    padding: 28px;
    border-radius: var(--radius-xl);
    background: var(--surface);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h2 {
    margin: 0;
    font-size: 2rem;
  }

  button {
    border: 0;
    font: inherit;
    color: var(--fg);
    cursor: pointer;
  }

  .icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--surface-2);
    display: grid;
    place-items: center;
  }

  .labels {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .labels button {
    min-height: 48px;
    padding: 0 20px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 1.15rem;
  }

  .labels button.selected {
    background: var(--sun);
    color: var(--bg);
    font-weight: 700;
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }

  .presets button {
    min-height: 72px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-size: 1.5rem;
    font-weight: 600;
  }

  .presets button:active,
  .labels button:active {
    background: var(--border-strong);
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .list li {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 1.2rem;
  }

  .list li span:first-child {
    flex: 1;
  }

  .secondary {
    min-height: 48px;
    padding: 0 18px;
    border-radius: 14px;
    background: var(--surface-2);
    font-weight: 700;
  }

  /* Par-dessus tout, veille comprise. */
  .ringing {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 64px;
    background: rgb(0 0 0 / 88%);
  }

  .alarm {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    animation: pulse 1.2s ease-in-out infinite;
  }

  .title {
    margin: 0;
    font-size: 3.5rem;
    font-weight: 700;
  }

  .muted {
    margin: 0;
    font-size: 1.5rem;
    color: var(--fg-muted);
  }

  .stop {
    margin-top: 16px;
    min-height: 80px;
    padding: 0 56px;
    border-radius: 999px;
    background: var(--sun);
    color: var(--bg);
    font-size: 1.8rem;
    font-weight: 700;
  }

  @keyframes pulse {
    50% {
      transform: scale(1.04);
    }
  }
</style>
