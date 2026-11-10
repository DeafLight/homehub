<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Note, Task } from '../../../shared/types.ts';
  import AddForm, { type AddInput } from '../components/AddForm.svelte';
  import Avatar from '../components/Avatar.svelte';
  import Icon from '../components/Icon.svelte';
  import NoteForm from '../components/NoteForm.svelte';
  import ShoppingPanel from '../components/ShoppingPanel.svelte';
  import TasksPanel from '../components/TasksPanel.svelte';
  import SportPanel from '../components/fitness/SportPanel.svelte';
  import BottomSheet from '../components/phone/BottomSheet.svelte';
  import PhoneAgenda from '../components/phone/PhoneAgenda.svelte';
  import PhoneNav from '../components/phone/PhoneNav.svelte';
  import PhoneNotes from '../components/phone/PhoneNotes.svelte';
  import PhoneRoutine from '../components/phone/PhoneRoutine.svelte';
  import HomeworkCard from '../components/widgets/HomeworkCard.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { createListsState } from '../lib/lists-state.svelte.ts';
  import { clearPairing, loadPairing } from '../lib/phone.ts';
  import { canMarkSeen, phoneTabs, receivedNotes, unseenCount } from '../lib/phone-app.ts';
  import { ApiError } from '../lib/api.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { PHONE_SCAN_PATH, PHONE_STOCK_PATH, type PhoneTab, phonePath } from '../lib/route.ts';

  const LISTS_REFRESH_MS = 15_000;
  const AGENDA_REFRESH_MS = 5 * 60_000;
  const ME_REFRESH_MS = 60_000;
  const NOTES_REFRESH_MS = 30_000;
  const ROUTINE_REFRESH_MS = 60_000;
  const HOMEWORK_REFRESH_MS = 10 * 60_000;

  // Appli du téléphone relié à un profil : courses, tâches (avec la routine du moment en tête), agenda des 7 prochains
  // jours, mots reçus et, pour un adulte qui a un programme, le sport. Tout ce qui est coché ou ajouté l'est au nom de
  // ce profil. `shared` : texte reçu par « Partager », qui ouvre directement l'ajout. Règles : lib/phone-app.ts ;
  // onglets : components/phone/.
  type Props = { tab: PhoneTab; shared?: string };
  let { tab, shared }: Props = $props();

  const { api, config, profiles, clock, navigate } = getAppContext();
  const pairing = loadPairing();
  const me = profiles.find((p) => p.id === pairing?.ownerId);
  const member = config.members.find((m) => m.id === pairing?.ownerId);

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

  const received = $derived(receivedNotes(notes.data ?? [], me?.id ?? ''));
  const unseen = $derived(unseenCount(received, member));
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

  const TABS = phoneTabs(Boolean(member?.fitness));
  let scroller = $state<HTMLElement | null>(null);
  const profileOf = (id: string) => profiles.find((p) => p.id === id);
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

    <main bind:this={scroller}>
      {#if lists.actionError}<p class="error">{lists.actionError}</p>{/if}

      {#if tab === 'notes'}
        <PhoneNotes
          received={notes.data ? received : null}
          loadError={notes.error}
          actionError={noteError}
          now={clock.now}
          {profileOf}
          canSee={(note) => canMarkSeen(member, note)}
          onSee={seeNote}
        />
      {:else if tab === 'agenda'}
        <PhoneAgenda weeks={agenda.data} loadError={agenda.error} meId={me.id} now={clock.now} {profileOf} />
      {:else if tab === 'sport'}
        {#if member?.fitness}
          <SportPanel {api} now={clock.now} onScrollTop={() => scroller?.scrollTo({ top: 0 })} />
        {:else}
          <p class="muted">Pas de programme de sport sur ce profil.</p>
        {/if}
      {:else if lists.data}
        {#if tab === 'shopping'}
          <button type="button" class="stock-link" onclick={() => navigate(PHONE_STOCK_PATH)}>
            <Icon name="box" size={24} /> Ce qu’il reste à la maison
          </button>
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
            <PhoneRoutine routine={routine.data} color={me.color} error={routineError} onToggle={toggleRoutine} />
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

    {#if tab === 'shopping'}
      <!-- Scanner du stock (caméra arrière) : ranger les courses, déclarer un produit épuisé. -->
      <button type="button" class="fab scan" aria-label="Scanner un produit" onclick={() => navigate(PHONE_SCAN_PATH)}>
        <Icon name="barcode" size={30} />
      </button>
    {:else if tab === 'tasks'}
      <button type="button" class="fab" aria-label="Ajouter une tâche" onclick={() => (adding = true)}>
        <Icon name="plus" size={30} strokeWidth={2.4} />
      </button>
    {:else if tab === 'notes'}
      <button type="button" class="fab" aria-label="Laisser un mot" onclick={() => (writing = true)}>
        <Icon name="plus" size={30} strokeWidth={2.4} />
      </button>
    {/if}

    <PhoneNav tabs={TABS} current={tab} {unseen} {routineLeft} onGo={(target) => navigate(phonePath(target))} />

    {#if writing}
      <BottomSheet label="Laisser un mot" onClose={() => (writing = false)}>
        <NoteForm from={me} profiles={profiles.filter((p) => p.id !== me.id)} onSubmit={writeNote} onCancel={() => (writing = false)} />
      </BottomSheet>
    {/if}

    {#if adding}
      <BottomSheet label="Ajouter" onClose={cancelAdd}>
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
      </BottomSheet>
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

  .stock-link {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 52px;
    margin-bottom: 14px;
    padding: 0 16px;
    border: 0;
    border-radius: 18px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-size: 1.05rem;
    font-weight: 600;
    text-align: left;
  }

  .homework {
    margin-bottom: 16px;
  }

  .homework :global(.card) {
    padding: 16px 18px;
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
