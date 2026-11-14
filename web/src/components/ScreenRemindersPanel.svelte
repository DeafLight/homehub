<script lang="ts">
  import { onMount } from 'svelte';
  import { SCREEN_REMINDER_LABELS, type ScreenReminderSetting } from '../../../shared/screen-reminders.ts';
  import { getAppContext } from '../lib/context.ts';
  import Icon from './Icon.svelte';

  // Rappels sur la télé (tablette, sous les télés) : à l'heure réglée, un bandeau sur les télés allumées avec l'appli
  // HomeHub TV (« Routine du soir : Léa, encore 2 étapes », « Mots à lire »). Chaque rappel s'active ou se coupe, son
  // heure se règle ; un parent reconnu enregistre (dès le geste). « Essayer » l'envoie tout de suite.
  const { api, actor } = getAppContext();

  let reminders = $state<ScreenReminderSetting[] | null>(null);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let tried = $state<{ kind: string; text: string; ok: boolean } | null>(null);

  onMount(async () => {
    try {
      reminders = (await api.screenReminders()).reminders;
    } catch (err) {
      error = (err as Error).message;
    }
  });

  async function save(next: ScreenReminderSetting) {
    if (!reminders || !(await actor.allow(null))) return;
    busy = next.kind;
    error = null;
    try {
      reminders = (await api.saveScreenReminders([next])).reminders;
    } catch (err) {
      actor.check(err);
      error = (err as Error).message;
    } finally {
      busy = null;
    }
  }

  async function test(reminder: ScreenReminderSetting) {
    if (!(await actor.allow(null))) return;
    busy = reminder.kind;
    tried = null;
    try {
      const shown = await api.testScreenReminder(reminder.kind);
      tried = { kind: reminder.kind, text: `Sur la télé : ${shown.title} — ${shown.subtitle}`, ok: true };
    } catch (err) {
      actor.check(err);
      tried = { kind: reminder.kind, text: (err as Error).message, ok: false };
    } finally {
      busy = null;
    }
  }
</script>

<section class="card reminders">
  <h2><Icon name="bell" size={28} /> Rappels sur la télé</h2>
  <p class="muted">Un bandeau sur les télés allumées, à l’heure dite. Des prénoms et des nombres seulement, comme sur la tablette.</p>
  {#if reminders}
    <ul>
      {#each reminders as reminder (reminder.kind)}
        <li>
          <button
            type="button"
            class="switch"
            role="switch"
            aria-checked={reminder.enabled}
            aria-label={SCREEN_REMINDER_LABELS[reminder.kind].name}
            disabled={busy === reminder.kind}
            onclick={() => save({ ...reminder, enabled: !reminder.enabled })}
          ><span></span></button>
          <span class="what" class:off={!reminder.enabled}>
            <span class="name">{SCREEN_REMINDER_LABELS[reminder.kind].name}</span>
            <span class="muted small">{SCREEN_REMINDER_LABELS[reminder.kind].hint}</span>
            {#if tried?.kind === reminder.kind}<span class="small" class:ok={tried.ok} class:error={!tried.ok}>{tried.text}</span>{/if}
          </span>
          <input
            type="time"
            value={reminder.time}
            disabled={!reminder.enabled || busy === reminder.kind}
            aria-label={`Heure du rappel « ${SCREEN_REMINDER_LABELS[reminder.kind].name} »`}
            onchange={(e) => e.currentTarget.value && save({ ...reminder, time: e.currentTarget.value })}
          />
          <button type="button" class="try" disabled={busy === reminder.kind} onclick={() => test(reminder)}>Essayer</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 28px;
    border-radius: var(--radius-lg);
    background: var(--surface);
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

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 18px;
    min-height: 72px;
    border-bottom: 1px solid var(--surface-2);
  }

  li:last-child {
    border-bottom: 0;
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

  .what {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .what.off .name {
    color: var(--fg-muted);
  }

  .name {
    font-size: 1.2rem;
    font-weight: 600;
  }

  input {
    min-height: 48px;
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1.15rem;
    color-scheme: dark;
  }

  input:disabled {
    opacity: 0.5;
  }

  .try {
    min-height: 44px;
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
