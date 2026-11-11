<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { formatHolidayDay } from '../../../shared/school-holidays.ts';
  import type { HolidayChoice, HolidaySettings, HolidaysData } from '../../../shared/types.ts';
  import BackButton from '../components/BackButton.svelte';
  import HolidayChip from '../components/HolidayChip.svelte';
  import Icon from '../components/Icon.svelte';
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import { choiceLabel, groupAcademies, sameChoice, ZONES, type Zone } from '../lib/holiday-settings.ts';
  import type { PageRoute } from '../lib/route.ts';

  // Réglage des vacances scolaires, ouvert depuis la roue dentée : le calendrier officiel d'une académie (liste
  // filtrée par la saisie, regroupée par zone) ou d'une zone entière, ou rien. Avant d'enregistrer, l'aperçu montre
  // les prochaines vacances du choix. Tout le monde peut regarder ; seul un parent reconnu enregistre.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, actor } = getAppContext();

  type Mode = 'academie' | 'zone' | 'none';

  let settings = $state<HolidaySettings | null>(null);
  let draft = $state<HolidayChoice>(null);
  let mode = $state<Mode>('academie');
  let query = $state('');
  let loadError = $state<string | null>(null);
  let message = $state<{ text: string; ok?: boolean } | null>(null);
  let saving = $state(false);
  let preview = $state<HolidaysData | 'loading' | 'error' | null>(null);

  const modeOf = (choice: HolidayChoice): Mode => (!choice ? 'none' : 'zone' in choice ? 'zone' : 'academie');
  const academies = $derived(settings?.academies ?? []);
  const groups = $derived(groupAcademies(academies, query));
  const dirty = $derived(settings !== null && !sameChoice(draft, settings.choice));
  const selectedAcademie = $derived(draft && 'academie' in draft ? draft.academie : null);
  const selectedZone = $derived(draft && 'zone' in draft ? draft.zone : null);
  /** Académies d'une zone, rappelées sous son bouton. */
  const academiesOf = (zone: Zone) => academies.filter((a) => a.zone === `Zone ${zone}`).map((a) => a.name).sort((a, b) => a.localeCompare(b, 'fr'));

  onMount(async () => {
    try {
      settings = await api.holidaySettings();
      draft = settings.choice;
      mode = draft ? modeOf(draft) : 'academie';
      // L'académie enregistrée peut être loin dans la liste : on la montre.
      await tick();
      document.querySelector('.holidays-page .option.on')?.scrollIntoView({ block: 'center' });
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  });

  // Aperçu du choix en cours ; une réponse arrivée après un autre choix est ignorée.
  let previewFor = 0;
  $effect(() => {
    const choice = $state.snapshot(draft);
    if (!settings) return;
    const ask = ++previewFor;
    if (!choice) return void (preview = null);
    preview = 'loading';
    api.previewHolidays(choice).then(
      (data) => ask === previewFor && (preview = data),
      () => ask === previewFor && (preview = 'error'),
    );
  });

  function pick(choice: HolidayChoice) {
    draft = choice;
    message = null;
  }

  function setMode(next: Mode) {
    mode = next;
    message = null;
    if (next === 'none') pick(null);
    else if (next !== modeOf(draft)) {
      // Choix de l'autre mode : on repart de ce qui était enregistré s'il était de ce mode, sinon rien de choisi.
      const savedChoice = settings?.choice ?? null;
      pick(modeOf(savedChoice) === next ? savedChoice : null);
    }
  }

  function cancel() {
    if (!settings) return;
    draft = settings.choice;
    mode = draft ? modeOf(draft) : 'academie';
    message = null;
  }

  async function save() {
    if (!settings || saving) return;
    if (mode !== 'none' && !draft) return void (message = { text: mode === 'zone' ? 'Choisis une zone' : 'Choisis une académie' });
    if (!(await actor.allow(null))) return;
    if ((await actor.isKiosk()) && !actor.current?.parent) return void (message = { text: 'Seul un parent peut régler les vacances' });
    saving = true;
    try {
      settings = await api.saveHolidaySettings(draft);
      draft = settings.choice;
      message = { text: 'Vacances enregistrées', ok: true };
    } catch (err) {
      actor.check(err);
      message = { text: err instanceof ApiError ? err.message : 'Enregistrement impossible' };
    } finally {
      saving = false;
    }
  }

  const MODES: { id: Mode; label: string }[] = [
    { id: 'academie', label: 'Par académie' },
    { id: 'zone', label: 'Par zone' },
    { id: 'none', label: 'Aucune' },
  ];
</script>

<div class="holidays-page">
  <header>
    <BackButton {back} />
    <h1>Vacances scolaires</h1>
    <span class="who muted">
      <Icon name="lock" size={22} />
      {#if actor.current?.parent}
        {actor.current.name} peut enregistrer
      {:else}
        Seul un parent peut enregistrer
      {/if}
    </span>
  </header>

  {#if loadError}
    <p class="muted">Réglage indisponible : {loadError}</p>
  {:else if settings}
    <div class="columns">
      <section class="card choose">
        <div class="modes" role="radiogroup" aria-label="Calendrier">
          {#each MODES as m (m.id)}
            <button type="button" role="radio" aria-checked={mode === m.id} class:on={mode === m.id} onclick={() => setMode(m.id)}>
              {m.label}
            </button>
          {/each}
        </div>

        {#if mode === 'academie'}
          <input type="search" placeholder="Chercher une académie (ex. Nantes)" aria-label="Chercher une académie" bind:value={query} />
          <div class="list">
            {#each groups as group (group.title)}
              <h2>{group.title}</h2>
              <div class="grid">
                {#each group.academies as a (a.name)}
                  <button type="button" class="option" class:on={selectedAcademie === a.name} aria-pressed={selectedAcademie === a.name} onclick={() => pick({ academie: a.name })}>
                    {a.name}
                  </button>
                {/each}
              </div>
            {:else}
              <p class="muted">Aucune académie ne correspond à « {query} ».</p>
            {/each}
          </div>
        {:else if mode === 'zone'}
          <div class="zones">
            {#each ZONES as z (z)}
              <button type="button" class="zone" class:on={selectedZone === z} aria-pressed={selectedZone === z} onclick={() => pick({ zone: z })}>
                <span class="letter">Zone {z}</span>
                <span class="small muted">{academiesOf(z).join(', ')}</span>
              </button>
            {/each}
          </div>
          <p class="muted small">La Corse et l’outre-mer ont leur propre calendrier : à choisir par académie.</p>
        {:else}
          <p class="muted">Pas de vacances affichées : les jours d’école restent les mêmes toute l’année.</p>
        {/if}
      </section>

      <section class="card preview">
        <h2><Icon name="calendar" size={26} /> Aperçu</h2>
        <p class="choice">{choiceLabel(draft, academies)}</p>
        {#if !draft}
          <p class="muted">{mode === 'none' ? 'Rien n’apparaîtra sur l’accueil ni dans les dashboards.' : 'Choisis un calendrier pour voir ses vacances.'}</p>
        {:else if preview === 'loading'}
          <p class="muted">Calendrier officiel en cours de lecture…</p>
        {:else if preview === 'error' || !preview?.holidays}
          <p class="muted">Calendrier officiel indisponible pour l’instant.</p>
        {:else}
          {#if preview.holiday}
            <HolidayChip holiday={preview.holiday} />
          {/if}
          <ul>
            {#each preview.holidays.slice(0, 5) as h (h.start)}
              <li>
                <span class="name">{h.name}</span>
                <span class="muted">dès le {formatHolidayDay(h.start)}{h.end ? ` · reprise ${formatHolidayDay(h.end)}` : ''}</span>
              </li>
            {:else}
              <li class="muted">Aucune période à venir publiée.</li>
            {/each}
          </ul>
        {/if}
        {#if !settings.saved}
          <p class="muted small">Pas encore enregistré : le fichier de configuration s’applique jusque-là.</p>
        {/if}
      </section>
    </div>

    <footer>
      {#if message}
        <span class="message" class:ok={message.ok}>{message.text}</span>
      {/if}
      <span class="actions">
        {#if dirty}
          <button type="button" class="secondary" onclick={cancel}>Annuler</button>
        {/if}
        <button type="button" class="primary" disabled={!dirty || saving} onclick={save}>
          {saving ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}
        </button>
      </span>
    </footer>
  {/if}
</div>

<style>
  .holidays-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 28px 40px 24px;
    box-sizing: border-box;
  }

  header {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  h1 {
    margin: 0;
    font-size: 2.5rem;
    font-weight: 600;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 0 8px;
    font-size: 1.3rem;
    font-weight: 600;
  }

  p {
    margin: 6px 0;
  }

  .muted {
    font-size: 1.1rem;
    color: var(--fg-muted);
  }

  .small {
    font-size: 1rem;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  button {
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.35;
  }

  .columns {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 18px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding: 18px 20px;
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .modes {
    display: flex;
    gap: 6px;
    padding: 6px;
    border-radius: 18px;
    background: var(--surface-2);
  }

  .modes button {
    flex: 1;
    min-height: 56px;
    border-radius: 14px;
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--fg-muted);
  }

  .modes button.on {
    background: var(--border-strong);
    color: var(--fg);
  }

  input {
    box-sizing: border-box;
    height: 56px;
    padding: 0 16px;
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 1.2rem;
    user-select: text;
  }

  input:focus {
    outline: none;
    border-color: var(--rain);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .list h2 {
    font-size: 1.1rem;
    color: var(--fg-muted);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 8px;
  }

  .option {
    min-height: 56px;
    padding: 0 14px;
    border: 2px solid transparent;
    border-radius: 14px;
    background: var(--surface-2);
    font-size: 1.15rem;
    text-align: left;
  }

  .option.on,
  .zone.on {
    border-color: var(--rain);
    background: var(--rain-bg);
    color: var(--fg);
  }

  .zones {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .zone {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-height: 84px;
    padding: 12px 18px;
    border: 2px solid transparent;
    border-radius: 16px;
    background: var(--surface-2);
    text-align: left;
  }

  .letter {
    font-size: 1.4rem;
    font-weight: 700;
  }

  .preview .choice {
    font-size: 1.3rem;
    font-weight: 600;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }

  li {
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    border-bottom: 1px solid var(--surface-2);
  }

  .name {
    font-size: 1.2rem;
    font-weight: 600;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .message {
    font-size: 1.15rem;
    color: var(--danger-fg);
  }

  .message.ok {
    color: var(--ok-fg);
  }

  .actions {
    display: flex;
    gap: 10px;
    margin-left: auto;
  }

  .primary,
  .secondary {
    min-height: 56px;
    padding: 0 30px;
    border-radius: 16px;
    font-size: 1.2rem;
    font-weight: 700;
  }

  .primary {
    background: var(--rain);
    color: var(--fg);
  }

  .secondary {
    background: var(--surface-2);
  }
</style>
