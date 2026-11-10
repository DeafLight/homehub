<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import TimerDial from './TimerDial.svelte';
  import TimerRing from './TimerRing.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { showsTimers } from '../lib/route.ts';
  import {
    DIAL_DEFAULT_MINUTES,
    endsAtText,
    formatCountdown,
    formatDuration,
    secondsLeft,
    TIMER_ACTIVITIES,
    TIMER_PRESETS,
    timerLook,
    timerName,
    TIMER_MAX_MINUTES,
    timerProgress,
  } from '../lib/timers.ts';

  // Minuteurs sur la tablette : ceux en cours, en bas de l'écran (toucher : l'arrêter) ; celui qui se termine prend
  // tout l'écran, par-dessus la veille, et sonne jusqu'à « Arrêter ». La fenêtre « Minuteur » en lance un : la durée
  // sur une roue (ou un raccourci), l'activité au choix (son emoji et sa couleur se retrouvent partout), puis « Lancer ».
  const REFRESH_MS = 5_000;
  const BEEP_EVERY_MS = 1_500;
  /** Au-delà, la sonnerie se tait (l'alerte reste affichée). */
  const RING_MAX_MS = 2 * 60_000;
  /** Durée de l'animation de la roue vers un raccourci. */
  const SPIN_MS = 350;

  const { actor, clock, router, timers } = getAppContext();

  let kiosk = $state(false);
  let label = $state('');
  let minutes = $state(DIAL_DEFAULT_MINUTES);
  let starting = $state(false);

  onMount(() => {
    void actor.isKiosk().then((value) => (kiosk = value));
  });

  const enabled = $derived(kiosk && showsTimers(router.route));
  const running = $derived(timers.list.filter((t) => secondsLeft(t, clock.now) > 0));
  const ringing = $derived(timers.list.filter((t) => secondsLeft(t, clock.now) === 0));
  /** Change seulement quand un minuteur se met à sonner ou s'arrête (pas à chaque seconde). */
  const ringingIds = $derived(ringing.map((t) => t.id).join(','));
  const look = $derived(timerLook(label));

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

  /** La roue tourne jusqu'au raccourci touché. */
  let spin = 0;
  function spinTo(target: number) {
    cancelAnimationFrame(spin);
    const from = minutes;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / SPIN_MS);
      minutes = Math.round(from + (target - from) * (1 - (1 - k) ** 3));
      if (k < 1) spin = requestAnimationFrame(step);
    };
    spin = requestAnimationFrame(step);
  }

  const nudge = (delta: number) => (minutes = Math.max(0, Math.min(TIMER_MAX_MINUTES, minutes + delta)));

  async function start() {
    if (minutes < 1 || starting) return;
    starting = true;
    try {
      if (await timers.start(label, minutes * 60)) {
        timers.dialog = false;
        label = '';
        minutes = DIAL_DEFAULT_MINUTES;
      }
    } finally {
      starting = false;
    }
  }
</script>

{#if enabled}
  {#if running.length && !timers.dialog}
    <div class="running" aria-label="Minuteurs en cours">
      {#each running as timer (timer.id)}
        {@const { emoji, color } = timerLook(timer.label)}
        <button type="button" class="pill" style:--accent={color} aria-label="Arrêter le minuteur {timerName(timer)}" onclick={() => timers.stop(timer.id)}>
          <TimerRing progress={timerProgress(timer, clock.now)} {color} />
          <span class="name">{emoji} {timerName(timer)}</span>
          <span class="left">{formatCountdown(secondsLeft(timer, clock.now))}</span>
          <Icon name="close" size={20} color="var(--fg-muted)" />
        </button>
      {/each}
    </div>
  {/if}

  {#if timers.dialog}
    <div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (timers.dialog = false)}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Minuteur" style:--accent={look.color}>
        <div class="dial-side">
          <TimerDial bind:minutes color={look.color} caption={endsAtText(clock.now, minutes)} />
          <div class="nudges">
            <button type="button" onclick={() => nudge(-1)} aria-label="Une minute de moins">− 1</button>
            <button type="button" onclick={() => nudge(1)} aria-label="Une minute de plus">+ 1</button>
            <button type="button" onclick={() => nudge(5)} aria-label="Cinq minutes de plus">+ 5</button>
            <button type="button" onclick={() => nudge(60)} aria-label="Une heure de plus">+ 1 h</button>
          </div>
        </div>

        <div class="choice-side">
          <header>
            <h2>Minuteur</h2>
            <button type="button" class="icon" aria-label="Fermer" onclick={() => (timers.dialog = false)}><Icon name="close" size={28} /></button>
          </header>
          <p class="muted small">Pour quoi ? (facultatif)</p>
          <div class="activities" role="radiogroup" aria-label="Pour quoi ?">
            {#each TIMER_ACTIVITIES as activity (activity.label)}
              <button
                type="button"
                role="radio"
                aria-checked={label === activity.label}
                class:selected={label === activity.label}
                style:--tone={activity.color}
                onclick={() => (label = label === activity.label ? '' : activity.label)}
              >
                <span class="emoji">{activity.emoji}</span>
                {activity.label}
              </button>
            {/each}
          </div>
          <div class="presets">
            {#each TIMER_PRESETS as preset (preset)}
              <button type="button" class:on={minutes === preset} onclick={() => spinTo(preset)}>{formatDuration(preset)}</button>
            {/each}
          </div>
          <button type="button" class="go" disabled={minutes < 1 || starting} onclick={start}>
            Lancer{label ? ` ${label.toLowerCase()}` : ''} · {formatDuration(Math.max(minutes, 1))}
          </button>
        </div>

        {#if running.length}
          <ul class="list">
            {#each running as timer (timer.id)}
              {@const { emoji, color } = timerLook(timer.label)}
              <li>
                <TimerRing progress={timerProgress(timer, clock.now)} {color} size={32} />
                <span class="list-name">{emoji} {timerName(timer)}</span>
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
        {@const { emoji, color } = timerLook(timer.label)}
        <div class="alarm" style:--accent={color}>
          <span class="alarm-emoji" aria-hidden="true">{emoji}</span>
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
    padding: 0 16px 0 12px;
    border: 2px solid var(--accent);
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
    width: min(920px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    box-sizing: border-box;
    padding: 24px 28px;
    border-radius: var(--radius-xl);
    background: var(--surface);
    overflow-y: auto;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 18px 32px;
  }

  .dial-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .choice-side {
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  .nudges {
    display: flex;
    gap: 10px;
  }

  .nudges button {
    width: 76px;
    min-height: 52px;
    border-radius: 16px;
    background: var(--surface-2);
    font-size: 1.25rem;
    font-weight: 700;
  }

  .activities {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .activities button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-height: 84px;
    padding: 8px 4px;
    border: 2px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-size: 1.1rem;
    font-weight: 600;
  }

  .activities button.selected {
    border-color: var(--tone);
    background: color-mix(in srgb, var(--tone) 24%, var(--surface));
  }

  .emoji {
    font-size: 2rem;
    line-height: 1;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .presets button {
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: none;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--fg-soft);
  }

  .presets button.on {
    border-color: var(--accent);
    color: var(--fg);
  }

  .nudges button:active,
  .presets button:active,
  .activities button:active {
    background: var(--border-strong);
  }

  .go {
    margin-top: auto;
    min-height: 72px;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--bg);
    font-size: 1.5rem;
    font-weight: 700;
  }

  .go:disabled {
    opacity: 0.35;
  }

  .muted {
    margin: 0;
    font-size: 1.5rem;
    color: var(--fg-muted);
  }

  .small {
    font-size: 1rem;
  }

  .list {
    grid-column: 1 / -1;
    margin: 0;
    padding: 14px 0 0;
    border-top: 1px solid var(--surface-2);
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .list li {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 1.2rem;
  }

  .list-name {
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

  .alarm-emoji {
    font-size: 6rem;
    line-height: 1;
  }

  .title {
    margin: 0;
    font-size: 3.5rem;
    font-weight: 700;
    color: var(--accent);
  }

  .stop {
    margin-top: 16px;
    min-height: 80px;
    padding: 0 56px;
    border-radius: 999px;
    background: var(--accent);
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
