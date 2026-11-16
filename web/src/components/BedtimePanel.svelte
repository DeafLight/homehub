<script lang="ts">
  import { onMount } from 'svelte';
  import {
    BEDTIME_DAYS,
    BEDTIME_EARLIEST,
    BEDTIME_LATEST,
    BEDTIME_REMINDER_CHOICES,
    BEDTIME_SCHEDULE_LABELS,
    BEDTIME_SCHEDULES,
    BEDTIME_SLEEP_CHOICES,
    type BedtimeSchedule,
    type BedtimeSettings,
    type BedtimeView,
  } from '../../../shared/bedtime.ts';
  import { withDay } from '../lib/bedtime.ts';
  import { getAppContext } from '../lib/context.ts';
  import BedtimeTonight from './BedtimeTonight.svelte';
  import Icon from './Icon.svelte';

  // Heure du coucher des enfants (tablette, sous les rappels sur la télé, fonction 16) : un interrupteur, le coucher de
  // ce soir (repousser, annuler), une heure par soir en période d'école et les veilles de vacances (heure effacée : pas
  // de coucher ce soir-là), le délai du rappel et celui de l'écran de veille. Un parent reconnu enregistre dès le geste.
  // « Essayer » montre le bandeau du rappel sur les télés allumées, sans rien mettre en pause.
  const { api, actor } = getAppContext();

  let view = $state<BedtimeView | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let tried = $state<{ text: string; ok: boolean } | null>(null);

  onMount(async () => {
    try {
      view = await api.bedtime();
    } catch (err) {
      error = (err as Error).message;
    }
  });

  async function save(next: BedtimeSettings) {
    if (!view || !(await actor.allow(null))) return;
    busy = true;
    error = null;
    try {
      view = await api.saveBedtime(next);
    } catch (err) {
      actor.check(err);
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  const setDay = (schedule: BedtimeSchedule, index: number, value: string) =>
    view && save({ ...view.settings, [schedule]: withDay(view.settings[schedule], index, value) });

  async function test() {
    if (!(await actor.allow(null))) return;
    busy = true;
    tried = null;
    try {
      const shown = await api.testBedtime();
      tried = { text: `Sur la télé : ${shown.title} — ${shown.subtitle}`, ok: true };
    } catch (err) {
      actor.check(err);
      tried = { text: (err as Error).message, ok: false };
    } finally {
      busy = false;
    }
  }
</script>

<section class="card bedtime">
  <div class="head">
    <h2><Icon name="moon" size={28} /> Coucher des enfants</h2>
    {#if view}
      <button
        type="button"
        class="switch"
        role="switch"
        aria-checked={view.settings.enabled}
        aria-label="Coucher des enfants sur la télé"
        disabled={busy}
        onclick={() => view && save({ ...view.settings, enabled: !view.settings.enabled })}
      ><span></span></button>
    {/if}
  </div>
  <p class="muted">Sur les télés allumées : un rappel, puis la pause à l’heure dite, puis l’écran de veille. Un parent repousse ou annule depuis son téléphone (télécommande).</p>
  {#if view}
    <BedtimeTonight {view} onchange={(next) => (view = next)} allow={() => actor.allow(null)} check={(err) => actor.check(err)} />
    <div class="weeks" class:off={!view.settings.enabled}>
      <div class="row days" aria-hidden="true">
        <span class="label"></span>
        {#each BEDTIME_DAYS as day (day.index)}<span class="day">{day.short}</span>{/each}
      </div>
      {#each BEDTIME_SCHEDULES as schedule (schedule)}
        <div class="row">
          <span class="label">{BEDTIME_SCHEDULE_LABELS[schedule]}</span>
          {#each BEDTIME_DAYS as day (day.index)}
            <input
              type="time"
              min={BEDTIME_EARLIEST}
              max={BEDTIME_LATEST}
              step="300"
              value={view.settings[schedule][day.index] ?? ''}
              disabled={busy}
              aria-label={`${BEDTIME_SCHEDULE_LABELS[schedule]}, ${day.name} soir`}
              onchange={(e) => setDay(schedule, day.index, e.currentTarget.value)}
            />
          {/each}
        </div>
      {/each}
      <p class="muted small">Veilles de vacances : les soirs dont le lendemain est en vacances scolaires ou férié. Heure effacée : pas de coucher ce soir-là.</p>
    </div>
    <div class="delays">
      <label>
        Rappel
        <select value={view.settings.reminderMin} disabled={busy} onchange={(e) => view && save({ ...view.settings, reminderMin: Number(e.currentTarget.value) })}>
          {#each BEDTIME_REMINDER_CHOICES as min (min)}<option value={min}>{min} min avant</option>{/each}
        </select>
      </label>
      <label>
        Écran de veille
        <select value={view.settings.sleepMin} disabled={busy} onchange={(e) => view && save({ ...view.settings, sleepMin: Number(e.currentTarget.value) })}>
          {#each BEDTIME_SLEEP_CHOICES as min (min)}<option value={min}>{min ? `${min} min après la pause` : 'avec la pause'}</option>{/each}
        </select>
      </label>
      <button type="button" class="try" disabled={busy} onclick={test}>Essayer le rappel</button>
    </div>
    {#if tried}<p class="small" class:ok={tried.ok} class:error={!tried.ok}>{tried.text}</p>{/if}
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px 28px;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  h2 {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  p {
    margin: 0;
  }

  .muted {
    font-size: 1.1rem;
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.95rem;
  }

  .switch {
    flex-shrink: 0;
    position: relative;
    width: 60px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
  }

  .switch span {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--fg-muted);
    transition: transform 0.15s;
  }

  .switch[aria-checked='true'] {
    background: var(--rain);
  }

  .switch[aria-checked='true'] span {
    transform: translateX(26px);
    background: var(--bg);
  }

  .weeks {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .weeks.off {
    opacity: 0.6;
  }

  .row {
    display: grid;
    grid-template-columns: 11rem repeat(7, minmax(0, 1fr));
    align-items: center;
    gap: 8px;
  }

  .label {
    font-size: 1.05rem;
    font-weight: 600;
  }

  .day {
    text-align: center;
    font-size: 0.95rem;
    color: var(--fg-muted);
  }

  input,
  select {
    min-height: 48px;
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1.05rem;
    color-scheme: dark;
  }

  input {
    min-width: 0;
  }

  .delays {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 18px;
  }

  label {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 1.05rem;
  }

  .try {
    min-height: 44px;
    margin-left: auto;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
  }

  .ok {
    color: var(--ok-fg);
  }

  .error {
    color: var(--danger-fg);
  }
</style>
