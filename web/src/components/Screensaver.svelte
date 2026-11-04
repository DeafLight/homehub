<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { formatLongDate, formatTime } from '../lib/format.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { isPhoneRoute } from '../lib/route.ts';
  import { formatCountdown, secondsLeft, timerLook, timerName } from '../lib/timers.ts';
  import { formatTemperature, weatherIcon, weatherIconColor, weatherLabel, weatherOutlook } from '../lib/weather.ts';

  // Veille de la tablette : après `ui.screensaverMinutes` sans contact ni visage devant la caméra, écran noir où seule
  // l'horloge (avec la date et la météo du moment) reste, et se déplace au hasard (pour ne pas marquer l'écran). Un contact, ou un visage vu par la caméra
  // (Presence.svelte), la réveille ; le contact qui réveille ne fait rien d'autre. Avec l'interface JavaScript de Fully
  // Kiosk, la luminosité baisse aussi pendant la veille. Les minuteurs en cours restent affichés sous l'horloge ; celui
  // qui se termine réveille la tablette (Timers.svelte l'affiche par-dessus).
  const MOVE_MS = 12_000;
  const CHECK_MS = 1_000;
  const DIM_BRIGHTNESS = 10;
  /** Après le réveil, l'écran noir reste un instant (fondu) pour absorber la fin du contact qui a réveillé. */
  const FADE_MS = 400;
  /** La météo change lentement : relue toutes les 10 minutes (le serveur la garde en cache). */
  const WEATHER_REFRESH_MS = 10 * 60_000;

  type Fully = { getScreenBrightness(): number; setScreenBrightness(level: number): void };

  const { actor, api, config, clock, router, timers } = getAppContext();
  /** Météo du moment, sur la tablette seulement (null : pas configurée). */
  const weather = createResource(async () => ((await actor.isKiosk()) ? (await api.home()).weather : null), WEATHER_REFRESH_MS);
  onDestroy(weather.destroy);
  const running = $derived(timers.list.filter((t) => secondsLeft(t, clock.now) > 0));
  const ringing = $derived(timers.list.some((t) => secondsLeft(t, clock.now) === 0));

  let kiosk = $state(false);
  let asleep = $state(false);
  /** Écran noir affiché : pendant la veille, et le temps du fondu au réveil. */
  let shown = $state(false);
  let sleptAt = $state(0);
  let lastTouch = Date.now();
  let position = $state({ x: 50, y: 50 });

  const enabled = $derived(kiosk && config.ui.screensaverMinutes > 0 && !isPhoneRoute(router.route));

  const fully = () => (globalThis as { fully?: Fully }).fully;
  let savedBrightness: number | null = null;

  function sleep() {
    asleep = true;
    shown = true;
    sleptAt = Date.now();
    move();
    try {
      savedBrightness = fully()?.getScreenBrightness() ?? null;
      fully()?.setScreenBrightness(DIM_BRIGHTNESS);
    } catch {
      savedBrightness = null; // interface absente ou refusée : écran noir seulement
    }
  }

  function wake() {
    if (!asleep) return;
    asleep = false;
    lastTouch = Date.now();
    setTimeout(() => (shown = asleep), FADE_MS);
    try {
      if (savedBrightness !== null) fully()?.setScreenBrightness(savedBrightness);
    } catch {
      // rien à rétablir
    }
    savedBrightness = null;
  }

  /** Nouvelle place au hasard, en gardant l'horloge entière à l'écran (positions en % du centre). */
  function move() {
    position = { x: 20 + Math.random() * 60, y: 20 + Math.random() * 60 };
  }

  onMount(() => {
    void actor.isKiosk().then((value) => (kiosk = value));
    const touched = () => {
      lastTouch = Date.now();
    };
    for (const type of ['pointerdown', 'keydown', 'wheel']) addEventListener(type, touched, { passive: true, capture: true });
    const check = setInterval(() => {
      if (!enabled || asleep) return;
      const last = Math.max(lastTouch, actor.lastFace);
      if (Date.now() - last > config.ui.screensaverMinutes * 60_000) sleep();
    }, CHECK_MS);
    const mover = setInterval(() => asleep && move(), MOVE_MS);
    return () => {
      for (const type of ['pointerdown', 'keydown', 'wheel']) removeEventListener(type, touched, { capture: true });
      clearInterval(check);
      clearInterval(mover);
      if (asleep) wake();
    };
  });

  // Quelqu'un arrive devant la caméra (après la mise en veille) : réveil.
  $effect(() => {
    if (asleep && actor.lastFace > sleptAt) wake();
  });

  $effect(() => {
    if (!enabled && asleep) wake();
  });

  $effect(() => {
    if (asleep && ringing) wake();
  });
</script>

{#if shown}
  <!-- Le contact qui réveille est absorbé : il ne coche ni n'ouvre rien dessous. -->
  <div
    class="screensaver"
    class:waking={!asleep}
    role="button"
    tabindex="-1"
    aria-label="Réveiller la tablette"
    onpointerdown={(e) => {
      e.preventDefault();
      e.stopPropagation();
      wake();
    }}
    onclick={(e) => e.stopPropagation()}
    onkeydown={wake}
  >
    <div class="clock" style:left="{position.x}%" style:top="{position.y}%">
      <div class="time">{formatTime(clock.now)}</div>
      <div class="date">{formatLongDate(clock.now)}</div>
      {#if weather.data}
        {@const now = weather.data}
        <div class="weather">
          <span class="weather-icon"><Icon name={weatherIcon(now.weatherCode, now.isDay)} size={44} color={weatherIconColor(now.weatherCode, now.isDay)} /></span>
          {formatTemperature(now.temperatureC)} · {weatherLabel(now.weatherCode)}
        </div>
        <div class="outlook">{weatherOutlook(now, clock.now)}</div>
      {/if}
      {#each running as timer (timer.id)}
        <div class="timer">{timerLook(timer.label).emoji} {timerName(timer)} · {formatCountdown(secondsLeft(timer, clock.now))}</div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .screensaver {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: #000;
    cursor: none;
    transition: opacity 0.4s;
  }

  .screensaver.waking {
    opacity: 0;
  }

  .clock {
    position: absolute;
    transform: translate(-50%, -50%);
    transition:
      left 4s ease-in-out,
      top 4s ease-in-out;
    text-align: center;
    color: #8a8f98;
    white-space: nowrap;
  }

  .time {
    font-size: 6rem;
    font-weight: 300;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .date {
    margin-top: 8px;
    font-size: 1.6rem;
  }

  .weather {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 18px;
    font-size: 1.8rem;
  }

  /* Couleurs de l'icône adoucies : la veille reste sombre. */
  .weather-icon {
    display: inline-grid;
    opacity: 0.6;
  }

  .outlook {
    margin-top: 4px;
    font-size: 1.2rem;
    color: #6b7079;
  }

  .timer {
    margin-top: 10px;
    font-size: 1.8rem;
    font-variant-numeric: tabular-nums;
    color: #b8963e;
  }
</style>
