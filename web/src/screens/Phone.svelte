<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { canWrite } from '../../../shared/rights.ts';
  import { FAMILY_ID, type Note, type Task } from '../../../shared/types.ts';
  import AddForm, { type AddInput } from '../components/AddForm.svelte';
  import Avatar from '../components/Avatar.svelte';
  import Icon from '../components/Icon.svelte';
  import NoteForm from '../components/NoteForm.svelte';
  import ShoppingPanel from '../components/ShoppingPanel.svelte';
  import TasksPanel from '../components/TasksPanel.svelte';
  import HomeworkCard from '../components/widgets/HomeworkCard.svelte';
  import { agendaDays } from '../lib/agenda.ts';
  import { getAppContext } from '../lib/context.ts';
  import { capitalize, formatAgo, formatDay } from '../lib/format.ts';
  import { createListsState } from '../lib/lists-state.svelte.ts';
  import { clearPairing, loadPairing } from '../lib/phone.ts';
  import { ApiError } from '../lib/api.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { routineFooter, routineTitle } from '../lib/routine.ts';
  import { type PhoneTab, phonePath } from '../lib/route.ts';

  const LISTS_REFRESH_MS = 15_000;
  const AGENDA_REFRESH_MS = 5 * 60_000;
  const ME_REFRESH_MS = 60_000;
  const NOTES_REFRESH_MS = 30_000;
  const ROUTINE_REFRESH_MS = 60_000;
  const HOMEWORK_REFRESH_MS = 10 * 60_000;

  // Appli du téléphone relié à un profil : courses, tâches (avec la routine du moment en tête), agenda des 7 prochains
  // jours et mots reçus. Tout ce qui est coché ou ajouté l'est au nom de ce profil. `shared` : texte reçu par « Partager », qui ouvre directement l'ajout.
  type Props = { tab: PhoneTab; shared?: string };
  let { tab, shared }: Props = $props();

  const { api, config, profiles, clock, navigate } = getAppContext();
  const pairing = loadPairing();
  const me = profiles.find((p) => p.id === pairing?.ownerId);
  /** « Vu » : sur les mots de mon profil ; ceux de toute la famille, seulement pour un parent. */
  const member = config.members.find((m) => m.id === pairing?.ownerId);
  const canMarkSeen = (note: Note) => member !== undefined && canWrite(member, note.to);

  /** Le serveur ne reconnaît plus le téléphone (retiré depuis la tablette). */
  let revoked = $state(false);
  function forget() {
    clearPairing();
    revoked = true;
  }
  const lists = createListsState(api, { refreshMs: LISTS_REFRESH_MS, onUnauthorized: forget });
  // Le serveur reconnaît-il encore ce téléphone ? Vérifié à l'ouverture puis régulièrement.
  const check = createResource(async () => {
    if (!pairing) return null;
    try {
      return await api.me();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) forget();
      throw err;
    }
  }, ME_REFRESH_MS);
  const agenda = createResource(() => Promise.all([api.week(0), api.week(1)]), AGENDA_REFRESH_MS);
  const notes = createResource(() => api.notes(), NOTES_REFRESH_MS);
  const routine = createResource(async () => (pairing ? (await api.routine(pairing.ownerId)).routine : null), ROUTINE_REFRESH_MS);
  // Devoirs (Pronote ou ÉcoleDirecte), en lecture seule ; le serveur les garde en cache, rafraîchis plus rarement.
  const homework = createResource(async () => (pairing ? (await api.homework(pairing.ownerId)).homework : null), HOMEWORK_REFRESH_MS);
  // Rouverte (téléphone sorti de la poche) : la routine a pu changer de période ou être cochée sur la tablette.
  const onVisible = () => document.visibilityState === 'visible' && void routine.refresh();
  document.addEventListener('visibilitychange', onVisible);
  onDestroy(() => {
    document.removeEventListener('visibilitychange', onVisible);
    routine.destroy();
    homework.destroy();
    lists.destroy();
    agenda.destroy();
    notes.destroy();
    check.destroy();
  });

  let filter = $state<string | null>(me?.id ?? null);
  let writing = $state(false);
  let noteError = $state<string | null>(null);

  /** Mots reçus (pour moi ou pour toute la famille, sauf les miens) : ceux pas encore vus d'abord. */
  const received = $derived(
    (notes.data ?? [])
      .filter((n) => (n.to === me?.id || n.to === FAMILY_ID) && n.from.ownerId !== me?.id)
      .sort((a, b) => Number(Boolean(a.seenAt)) - Number(Boolean(b.seenAt))),
  );
  const unseen = $derived(received.filter((n) => !n.seenAt && canMarkSeen(n)).length);
  /** Étapes de la routine du moment pas encore cochées (pastille de l'onglet Tâches). */
  const routineLeft = $derived(routine.data?.items.filter((i) => !i.done).length ?? 0);
  let routineError = $state<string | null>(null);

  async function toggleRoutine(item: Task, done: boolean) {
    const current = routine.data;
    if (!current || !me) return;
    routineError = null;
    routine.set({ ...current, items: current.items.map((i) => (i.id === item.id ? { ...i, done } : i)) });
    try {
      await api.setRoutineDone(me.id, item.id, done);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) forget();
      routineError = (err as Error).message;
    } finally {
      await routine.refresh();
    }
  }

  async function seeNote(note: Note) {
    noteError = null;
    try {
      notes.set((notes.data ?? []).map((n) => (n.id === note.id ? { ...n, seenAt: new Date().toISOString() } : n)));
      await api.markNoteSeen(note.id);
    } catch (err) {
      noteError = (err as Error).message;
    } finally {
      await notes.refresh();
    }
  }

  async function writeNote({ to, text }: { to: string; text: string }) {
    await api.addNote(to, text);
    writing = false;
    await notes.refresh();
  }
  let adding = $state(untrack(() => shared !== undefined));

  async function add(input: AddInput) {
    if (input.kind === 'shopping') await lists.addShopping(input.label);
    else await lists.addTask({ label: input.label, ownerId: input.ownerId, due: input.due, repeat: input.repeat });
    adding = false;
    const target = input.kind === 'shopping' ? 'shopping' : 'tasks';
    if (shared !== undefined || target !== tab) navigate(phonePath(target));
  }

  function cancelAdd() {
    adding = false;
    if (shared !== undefined) navigate(phonePath(tab));
  }

  const TABS: { tab: PhoneTab; label: string; icon: 'cart' | 'check' | 'calendar' | 'message' }[] = [
    { tab: 'shopping', label: 'Courses', icon: 'cart' },
    { tab: 'tasks', label: 'Tâches', icon: 'check' },
    { tab: 'agenda', label: 'Agenda', icon: 'calendar' },
    { tab: 'notes', label: 'Mots', icon: 'message' },
  ];
  const nameOf = (id: string) => profiles.find((p) => p.id === id);
</script>

<div class="phone">
  {#if !pairing || !me || revoked}
    <div class="unpaired">
      <Icon name="phone" size={64} color="var(--fg-muted)" />
      <h1>{revoked ? 'Ce téléphone a été retiré' : 'Ce téléphone n’est pas relié'}</h1>
      <p>Sur la tablette, ouvre <strong>la roue dentée › Téléphones</strong>, choisis ton profil et scanne le code avec l’appareil photo.</p>
    </div>
  {:else}
    <header>
      <Avatar profile={me} size={40} />
      <h1>{TABS.find((t) => t.tab === tab)?.label}</h1>
      <span class="who">{me.name}</span>
    </header>

    <main>
      {#if lists.actionError}<p class="error">{lists.actionError}</p>{/if}

      {#if tab === 'notes'}
        {#if noteError}<p class="error">{noteError}</p>{/if}
        {#if notes.data}
          <ul class="notes">
            {#each received as note (note.id)}
              {@const author = nameOf(note.from.ownerId ?? '')}
              <li class:read={note.seenAt}>
                {#if author}<Avatar profile={author} size={36} />{/if}
                <div class="note-body">
                  <span class="note-text">{note.text}</span>
                  <span class="muted small">
                    {author?.name ?? 'Tablette'}{note.to === FAMILY_ID ? ' · pour la famille' : ''} · {formatAgo(new Date(note.at), clock.now)}
                  </span>
                </div>
                {#if !note.seenAt && canMarkSeen(note)}
                  <button type="button" class="seen" onclick={() => seeNote(note)}>Vu</button>
                {/if}
              </li>
            {:else}
              <li class="muted">Pas de mot cette semaine.</li>
            {/each}
          </ul>
        {:else if notes.error}
          <p class="muted">Impossible de charger les mots : {notes.error}</p>
        {/if}
      {:else if tab === 'agenda'}
        {#if agenda.data}
          {#each agendaDays(agenda.data, new Set([me.id, FAMILY_ID]), clock.now) as day (day.date.getTime())}
            <section class="day">
              <h2>{capitalize(formatDay(day.date, clock.now))}</h2>
              <ul>
                {#each day.items as item (item.id)}
                  {@const owner = nameOf(item.ownerId)}
                  <li>
                    <span class="when">{item.when}</span>
                    <span class="title">{item.title}</span>
                    {#if owner}<Avatar profile={owner} size={26} />{/if}
                  </li>
                {/each}
              </ul>
            </section>
          {:else}
            <p class="muted">Rien de prévu cette semaine.</p>
          {/each}
        {:else if agenda.error}
          <p class="muted">Impossible de charger l’agenda : {agenda.error}</p>
        {/if}
      {:else if lists.data}
        {#if tab === 'shopping'}
          <ShoppingPanel
            items={lists.data.shopping}
            frequent={lists.data.frequent}
            onAdd={lists.addShopping}
            onToggle={lists.setShoppingDone}
            onRemove={lists.removeShopping}
            onClear={lists.clearShopping}
          />
        {:else}
          {#if routine.data}
            {@const current = routine.data}
            {@const footer = routineFooter(current)}
            <section class="routine" aria-label={routineTitle(current)}>
              <h2>{routineTitle(current)}</h2>
              {#if routineError}<p class="error">{routineError}</p>{/if}
              <ul>
                {#each current.items as item (item.id)}
                  <li>
                    <label class:done={item.done}>
                      <input type="checkbox" checked={item.done} style:accent-color={me.color} onchange={(e) => toggleRoutine(item, e.currentTarget.checked)} />
                      {item.label}
                    </label>
                  </li>
                {/each}
              </ul>
              {#if footer}<p class="routine-footer">{footer}</p>{/if}
            </section>
          {/if}
          {#if homework.data}
            <div class="homework">
              <HomeworkCard homework={homework.data} now={clock.now} color={me.color} compact />
            </div>
          {/if}
          <TasksPanel
            tasks={lists.data.tasks}
            {profiles}
            now={clock.now}
            {filter}
            onFilter={(id) => (filter = id)}
            onToggle={lists.setTaskDone}
            onRemove={lists.removeTask}
          />
        {/if}
      {:else if lists.error}
        <p class="muted">Impossible de charger les listes : {lists.error}</p>
      {/if}
    </main>

    {#if tab === 'tasks'}
      <button type="button" class="fab" aria-label="Ajouter une tâche" onclick={() => (adding = true)}>
        <Icon name="plus" size={30} strokeWidth={2.4} />
      </button>
    {:else if tab === 'notes'}
      <button type="button" class="fab" aria-label="Laisser un mot" onclick={() => (writing = true)}>
        <Icon name="plus" size={30} strokeWidth={2.4} />
      </button>
    {/if}

    <nav>
      {#each TABS as item (item.tab)}
        <button type="button" class:on={item.tab === tab} aria-current={item.tab === tab ? 'page' : undefined} onclick={() => navigate(phonePath(item.tab))}>
          <span class="tab-icon">
            <Icon name={item.icon} size={26} />
            {#if item.tab === 'notes' && unseen > 0}<span class="badge">{unseen}</span>{/if}
            {#if item.tab === 'tasks' && routineLeft > 0}<span class="badge routine-badge">{routineLeft}</span>{/if}
          </span>
          {item.label}
        </button>
      {/each}
    </nav>

    {#if writing}
      <div class="sheet-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (writing = false)}>
        <div class="sheet" role="dialog" aria-modal="true" aria-label="Laisser un mot">
          <NoteForm from={me} profiles={profiles.filter((p) => p.id !== me.id)} onSubmit={writeNote} onCancel={() => (writing = false)} />
        </div>
      </div>
    {/if}

    {#if adding}
      <div class="sheet-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && cancelAdd()}>
        <div class="sheet" role="dialog" aria-modal="true" aria-label="Ajouter">
          <AddForm
            kind={tab === 'shopping' ? 'shopping' : 'task'}
            text={shared ?? ''}
            ownerId={me.id}
            {profiles}
            now={clock.now}
            note={shared !== undefined ? 'Partagé depuis une autre appli' : undefined}
            onSubmit={add}
            onCancel={cancelAdd}
          />
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .phone {
    --list-font: 1.15rem;
    --list-row: 54px;

    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 640px;
    margin: 0 auto;
  }

  header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: calc(14px + env(safe-area-inset-top)) 16px 10px;
  }

  h1 {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 700;
  }

  .who {
    margin-left: auto;
    color: var(--fg-muted);
  }

  main {
    flex: 1;
    min-height: 0;
    padding: 6px 16px 96px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .muted {
    color: var(--fg-muted);
  }

  .error {
    margin: 0 0 12px;
    color: var(--danger-fg);
  }

  .day h2 {
    margin: 18px 0 6px;
    font-size: 0.9rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .day ul {
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: 18px;
    background: var(--surface);
  }

  .day li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 0 14px;
    border-bottom: 1px solid var(--surface-2);
  }

  .day li:last-child {
    border-bottom: 0;
  }

  .when {
    min-width: 58px;
    font-variant-numeric: tabular-nums;
    color: var(--fg-muted);
  }

  .title {
    flex: 1;
    font-size: 1.1rem;
  }

  .notes {
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: 18px;
    background: var(--surface);
  }

  .notes li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--surface-2);
  }

  .notes li:last-child {
    border-bottom: 0;
  }

  .notes li.read {
    opacity: 0.55;
  }

  .note-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .note-text {
    font-size: 1.15rem;
    overflow-wrap: anywhere;
  }

  .small {
    font-size: 0.9rem;
  }

  .seen {
    min-height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--rain);
    color: var(--bg);
    font: inherit;
    font-weight: 700;
  }

  .homework {
    margin-bottom: 16px;
  }

  .homework :global(.card) {
    padding: 16px 18px;
  }

  .routine {
    margin-bottom: 18px;
    padding: 12px 14px 6px;
    border-radius: 18px;
    background: var(--surface);
  }

  .routine h2 {
    margin: 0 0 4px;
    font-size: 1.15rem;
    font-weight: 700;
  }

  .routine ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .routine li {
    border-bottom: 1px solid var(--surface-2);
  }

  .routine li:last-child {
    border-bottom: 0;
  }

  .routine label {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: var(--list-row);
    font-size: var(--list-font);
  }

  .routine label.done {
    color: var(--fg-muted);
    text-decoration: line-through;
  }

  .routine input {
    width: 26px;
    height: 26px;
    margin: 0;
  }

  .routine-footer {
    margin: 4px 0 8px;
    color: var(--ok-fg);
    font-weight: 600;
  }

  .badge.routine-badge {
    background: var(--rain-soft);
  }

  .tab-icon {
    position: relative;
    display: inline-grid;
  }

  .badge {
    position: absolute;
    top: -6px;
    right: -12px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--danger-fg);
    color: var(--bg);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
  }

  .fab {
    position: fixed;
    right: max(18px, calc(50vw - 302px));
    bottom: calc(88px + env(safe-area-inset-bottom));
    display: grid;
    width: 62px;
    height: 62px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--rain);
    color: var(--bg);
    box-shadow: 0 6px 18px rgb(0 0 0 / 40%);
  }

  nav {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    padding: 6px 8px calc(8px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--surface-2);
    background: var(--surface-rail);
  }

  nav button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 0;
    border-radius: 14px;
    border: 0;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
  }

  nav button.on {
    color: var(--fg);
    background: var(--surface-2);
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgb(0 0 0 / 60%);
  }

  .sheet {
    width: 100%;
    max-width: 640px;
    max-height: 92dvh;
    box-sizing: border-box;
    padding: 22px 16px calc(16px + env(safe-area-inset-bottom));
    border-radius: 26px 26px 0 0;
    background: var(--surface);
    overflow-y: auto;
  }

  .sheet :global(textarea) {
    font-size: max(16px, 1.1rem);
  }

  .unpaired {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 32px 24px;
    text-align: center;
  }

  .unpaired h1 {
    font-size: 1.5rem;
  }

  .unpaired p {
    margin: 0;
    font-size: 1.1rem;
    line-height: 1.5;
    color: var(--fg-soft);
  }
</style>
