<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { AddressMatch, CommuteSettings, PlaceIcon, RouteOption, StopChoice, TransitPlace, TransitSettings } from '../../../shared/types.ts';
  import BackButton from '../components/BackButton.svelte';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import { WEEK } from '../lib/routine-edit.ts';
  import type { PageRoute } from '../lib/route.ts';
  import { isTram } from '../lib/transit.ts';
  import {
    MAX_HOME_STOPS,
    MAX_PLACES,
    newCommute,
    newPlaceId,
    nextIcon,
    placeInUse,
    routeKey,
    settingsProblem,
    suggestPlace,
    toggleDay,
    toInput,
  } from '../lib/transit-edit.ts';

  // Réglages des transports, ouverts depuis la roue dentée : les lieux de la famille (situés par leur adresse), le
  // trajet de chacun (ligne directe proposée d'après les horaires Irigo, calé sur l'emploi du temps ou sur une plage
  // fixe) et les arrêts de l'accueil. Tout le monde peut regarder ; seul un parent reconnu enregistre.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, actor, profiles } = getAppContext();
  const members = profiles.filter((p) => !p.isFamily);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const ICONS: Record<PlaceIcon, IconName> = { home: 'home', school: 'school', sport: 'flag', place: 'pin' };
  const SEARCH_DELAY_MS = 400;

  let saved = $state<TransitSettings | null>(null);
  let draft = $state<TransitSettings | null>(null);
  let loadError = $state<string | null>(null);
  let message = $state<{ text: string; ok?: boolean } | null>(null);
  let saving = $state(false);
  let selected = $state(members[0]?.id ?? '');

  const clone = (s: TransitSettings) => JSON.parse(JSON.stringify(s)) as TransitSettings;
  const dirty = $derived(Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)));
  const commute = $derived(draft?.commutes[selected]);
  const placeOf = (id: string | undefined) => draft?.places.find((p) => p.id === id);

  onMount(async () => {
    try {
      saved = await api.transitSettings();
      draft = clone(saved);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  });

  const edit = () => (message = null);
  /** Champ de recherche ouvert d'un toucher : prêt à taper. */
  const focus = (node: HTMLInputElement) => node.focus();

  // --- Recherche (adresses, arrêts) : après une courte pause de frappe. --------------------------------------
  const timers = new Set<ReturnType<typeof setTimeout>>();
  onDestroy(() => timers.forEach(clearTimeout));
  function debounce(run: () => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return () => {
      if (timer) (clearTimeout(timer), timers.delete(timer));
      timer = setTimeout(run, SEARCH_DELAY_MS);
      timers.add(timer);
    };
  }

  // --- Lieux -------------------------------------------------------------------------------------------------
  /** Lieu dont on cherche l'adresse : un nouveau (`new`) ou un existant (son identifiant). */
  let addressFor = $state<string | null>(null);
  let addressQuery = $state('');
  let addresses = $state<AddressMatch[]>([]);
  let addressError = $state<string | null>(null);
  const searchAddresses = debounce(async () => {
    const q = addressQuery.trim();
    if (q.length < 3) return void (addresses = []);
    try {
      addresses = (await api.searchAddresses(q)).addresses;
      addressError = addresses.length ? null : 'Aucune adresse trouvée';
    } catch (err) {
      addressError = err instanceof ApiError ? err.message : 'Recherche impossible';
    }
  });

  function openAddress(target: string) {
    addressFor = target;
    addressQuery = target === 'new' ? '' : (placeOf(target)?.address ?? '');
    addresses = [];
    addressError = null;
  }

  function pickAddress(match: AddressMatch) {
    if (!draft || !addressFor) return;
    const place = placeOf(addressFor);
    if (place) {
      Object.assign(place, { address: match.label, lat: match.lat, lon: match.lon });
      // Les itinéraires partant de ce lieu ou y menant sont à revoir.
      for (const c of Object.values(draft.commutes)) if (c.from === place.id || c.to === place.id) c.route = null;
    } else {
      draft.places.push({ id: newPlaceId(draft.places), ...suggestPlace(draft.places), address: match.label, lat: match.lat, lon: match.lon });
    }
    addressFor = null;
    edit();
    void loadNearCounts();
  }

  function removePlace(place: TransitPlace) {
    if (!draft) return;
    if (placeInUse(draft, place.id)) return void (message = { text: `« ${place.label} » sert à un trajet : change d’abord le trajet` });
    draft.places = draft.places.filter((p) => p.id !== place.id);
    edit();
  }

  /** Arrêts proches de chaque lieu (nombre affiché, et choix rapide pour l'accueil). */
  let near = $state<Record<string, StopChoice[]>>({});
  async function loadNearCounts() {
    for (const place of draft?.places ?? []) {
      const key = `${place.lat},${place.lon}`;
      if (near[key]) continue;
      try {
        near[key] = (await api.stopsNear(place)).stops;
      } catch {
        // Horaires indisponibles : pas de compte.
      }
    }
  }
  const nearOf = (place: TransitPlace) => near[`${place.lat},${place.lon}`];
  $effect(() => {
    if (draft) void loadNearCounts();
  });

  // --- Trajets -----------------------------------------------------------------------------------------------
  let routes = $state<RouteOption[] | null>(null);
  let routesError = $state<string | null>(null);
  let routesFor = '';
  $effect(() => {
    const c = commute;
    const from = placeOf(c?.from);
    const to = placeOf(c?.to);
    const key = from && to ? `${from.lat},${from.lon}>${to.lat},${to.lon}` : '';
    if (key === routesFor) return;
    routesFor = key;
    routes = null;
    routesError = null;
    if (!from || !to || from === to) return;
    api
      .transitRoutes(from, to)
      .then((r) => {
        if (routesFor === key) routes = r.routes;
      })
      .catch((err) => {
        if (routesFor === key) routesError = err instanceof ApiError ? err.message : 'Itinéraires indisponibles';
      });
  });
  /** Itinéraires proposés, et celui déjà choisi s'il n'en fait plus partie (horaires changés). */
  const choices = $derived.by(() => {
    const list = routes ?? [];
    const route = commute?.route;
    if (!route || list.some((r) => routeKey(r) === routeKey(route))) return list;
    return [{ ...route, totalMinutes: route.walkFrom + route.rideMinutes + route.walkTo }, ...list];
  });

  function addCommute() {
    if (!draft) return;
    draft.commutes[selected] = newCommute(draft.places);
    edit();
  }

  function setPlace(c: CommuteSettings, end: 'from' | 'to', id: string) {
    c[end] = id;
    c.route = null;
    edit();
  }

  function chooseRoute(c: CommuteSettings, option: RouteOption) {
    const { totalMinutes: _, ...route } = option;
    c.route = route;
    edit();
  }

  function setWalk(c: CommuteSettings, end: 'walkFrom' | 'walkTo', value: string) {
    const n = Number(value);
    c[end] = value === '' || !Number.isFinite(n) ? null : Math.max(0, Math.min(60, Math.round(n)));
    edit();
  }

  function setMinutes(c: CommuteSettings, field: 'arriveBefore' | 'showBefore', value: string) {
    const n = Math.round(Number(value));
    if (Number.isFinite(n)) c[field] = Math.max(0, Math.min(field === 'showBefore' ? 120 : 60, n));
    edit();
  }

  function removeCommute() {
    if (!draft) return;
    delete draft.commutes[selected];
    edit();
  }

  // --- Arrêts de l'accueil -----------------------------------------------------------------------------------
  let stopQuery = $state('');
  let stopResults = $state<StopChoice[]>([]);
  let stopError = $state<string | null>(null);
  const searchStops = debounce(async () => {
    const q = stopQuery.trim();
    if (q.length < 2) return void (stopResults = []);
    try {
      stopResults = (await api.searchStops(q)).stops;
      stopError = stopResults.length ? null : 'Aucun arrêt trouvé';
    } catch (err) {
      stopError = err instanceof ApiError ? err.message : 'Recherche impossible';
    }
  });

  function showNear(place: TransitPlace) {
    stopQuery = '';
    stopResults = nearOf(place) ?? [];
    stopError = stopResults.length ? null : `Pas d’arrêt près de ${place.label}`;
  }

  function addStop(stop: StopChoice) {
    if (!draft || draft.stops.some((s) => s.id === stop.id)) return;
    if (draft.stops.length >= MAX_HOME_STOPS) return void (message = { text: `${MAX_HOME_STOPS} arrêts au plus à l’accueil` });
    draft.stops.push({ id: stop.id, label: stop.name });
    edit();
  }

  // --- Enregistrement ----------------------------------------------------------------------------------------
  function cancel() {
    if (saved) draft = clone(saved);
    message = null;
  }

  async function save() {
    if (!draft || saving) return;
    const input = toInput(draft);
    const problem = settingsProblem(input, nameOf);
    if (problem) return void (message = { text: problem });
    if (!(await actor.allow(null))) return;
    if ((await actor.isKiosk()) && !actor.current?.parent) return void (message = { text: 'Seul un parent peut enregistrer les transports' });
    saving = true;
    try {
      saved = await api.saveTransitSettings(input);
      draft = clone(saved);
      message = { text: 'Transports enregistrés', ok: true };
    } catch (err) {
      actor.check(err);
      message = { text: err instanceof ApiError ? err.message : 'Enregistrement impossible' };
    } finally {
      saving = false;
    }
  }
</script>

{#snippet lines(list: string[])}
  <span class="lines">
    {#each list.slice(0, 6) as line (line)}
      <span class="line" class:tram={isTram(line)}>{line}</span>
    {/each}
  </span>
{/snippet}

{#snippet addressSearch()}
  <div class="search">
    <input
      type="search"
      placeholder="12 rue des Lilas, Angers"
      aria-label="Adresse"
      use:focus
      bind:value={addressQuery}
      oninput={searchAddresses}
    />
    <button type="button" class="secondary" onclick={() => (addressFor = null)}>Annuler</button>
  </div>
  {#if addressError}<p class="muted">{addressError}</p>{/if}
  {#each addresses as match (match.label)}
    <button type="button" class="result" onclick={() => pickAddress(match)}><Icon name="pin" size={22} /> {match.label}</button>
  {/each}
{/snippet}

{#snippet walk(c: CommuteSettings, end: 'walkFrom' | 'walkTo', label: string, estimate: number | undefined)}
  <label class="walk">
    <Icon name="walk" size={22} />
    <span>{label}</span>
    <input
      type="number"
      min="0"
      max="60"
      inputmode="numeric"
      aria-label={label}
      placeholder={estimate === undefined ? '' : String(estimate)}
      value={c[end] ?? ''}
      oninput={(e) => setWalk(c, end, e.currentTarget.value)}
    />
    <span class="muted">min{c[end] === null && estimate !== undefined ? ' (estimé)' : ''}</span>
    {#if c[end] !== null}
      <button type="button" class="link" onclick={() => ((c[end] = null), edit())}>Revenir à l’estimation</button>
    {/if}
  </label>
{/snippet}

<div class="transit-page">
  <header>
    <BackButton {back} />
    <h1>Transports</h1>
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
    <p class="muted">Réglages indisponibles : {loadError}</p>
  {:else if draft}
    <div class="scroll">
      <div class="columns">
        <div class="column">
          <section class="card">
            <h2><Icon name="pin" size={28} /> Lieux</h2>
            {#each draft.places as place (place.id)}
              <div class="row">
                <button type="button" class="icon" aria-label="Changer l'icône de « {place.label} »" onclick={() => ((place.icon = nextIcon(place.icon)), edit())}>
                  <Icon name={ICONS[place.icon]} size={26} />
                </button>
                <span class="place">
                  <input class="label" type="text" maxlength="30" aria-label="Nom du lieu" bind:value={place.label} oninput={edit} />
                  <button type="button" class="address" onclick={() => openAddress(place.id)}>{place.address}</button>
                </span>
                {#if nearOf(place)}
                  <span class="pill">{nearOf(place)?.length ? `${nearOf(place)?.length} arrêts proches` : 'aucun arrêt proche'}</span>
                {/if}
                <button type="button" class="remove" aria-label="Supprimer « {place.label} »" onclick={() => removePlace(place)}><Icon name="trash" size={22} /></button>
              </div>
              {#if addressFor === place.id}{@render addressSearch()}{/if}
            {:else}
              <p class="muted">Ajoute la maison, puis l’école : les arrêts et les lignes sont trouvés à partir des adresses.</p>
            {/each}
            {#if addressFor === 'new'}
              {@render addressSearch()}
            {:else if draft.places.length < MAX_PLACES}
              <button type="button" class="secondary add" onclick={() => openAddress('new')}><Icon name="plus" size={22} /> Ajouter un lieu</button>
            {/if}
            <p class="muted small">Adresses cherchées sur la Géoplateforme de l’IGN ; gardées sur le NAS seulement.</p>
          </section>

          <section class="card">
            <h2><Icon name="home" size={28} /> Arrêts de l’accueil <span class="muted small">({MAX_HOME_STOPS} au plus)</span></h2>
            {#each draft.stops as stop, i (stop.id)}
              <div class="row">
                <span class="grow">{stop.label ?? stop.id} <span class="muted small">{stop.id}</span></span>
                <button type="button" class="remove" aria-label="Retirer « {stop.label ?? stop.id} »" onclick={() => (draft!.stops.splice(i, 1), edit())}><Icon name="close" size={22} /></button>
              </div>
            {:else}
              <p class="muted">Aucun arrêt affiché à l’accueil.</p>
            {/each}
            {#if draft.stops.length < MAX_HOME_STOPS}
              <div class="search">
                <input type="search" placeholder="Roseraie, Ralliement…" aria-label="Chercher un arrêt" bind:value={stopQuery} oninput={searchStops} />
                {#each draft.places as place (place.id)}
                  <button type="button" class="secondary" onclick={() => showNear(place)}>Près de {place.label}</button>
                {/each}
              </div>
              {#if stopError}<p class="muted">{stopError}</p>{/if}
              {#each stopResults as stop (stop.id)}
                <button type="button" class="result" disabled={draft.stops.some((s) => s.id === stop.id)} onclick={() => addStop(stop)}>
                  <span class="grow">
                    {stop.name}
                    <span class="muted small">{stop.towards.length ? `vers ${stop.towards.join(', ')}` : ''}{stop.walkMinutes ? ` · ${stop.walkMinutes} min à pied` : ''}</span>
                  </span>
                  {@render lines(stop.lines)}
                </button>
              {/each}
            {/if}
          </section>
        </div>

        <section class="card">
          <h2><Icon name="bus" size={28} /> Trajets</h2>
          <div class="members" role="tablist">
            {#each members as member (member.id)}
              <button
                type="button"
                role="tab"
                class="member"
                class:on={member.id === selected}
                aria-selected={member.id === selected}
                style:--member={member.color}
                onclick={() => (selected = member.id)}
              >
                <span class="dot"></span>{member.name}
              </button>
            {/each}
          </div>

          {#if !commute}
            {#if draft.places.length < 2}
              <p class="muted">Ajoute au moins deux lieux (la maison et l’école) pour régler un trajet.</p>
            {:else}
              <p class="muted">Pas de trajet pour {nameOf(selected)}.</p>
              <button type="button" class="secondary add" onclick={addCommute}><Icon name="plus" size={22} /> Ajouter un trajet</button>
            {/if}
          {:else}
            {@const c = commute}
            <div class="ends">
              <label>
                <span class="muted">Départ</span>
                <select value={c.from} onchange={(e) => setPlace(c, 'from', e.currentTarget.value)}>
                  {#each draft.places as place (place.id)}<option value={place.id}>{place.label}</option>{/each}
                </select>
              </label>
              <label>
                <span class="muted">Arrivée</span>
                <select value={c.to} onchange={(e) => setPlace(c, 'to', e.currentTarget.value)}>
                  {#each draft.places as place (place.id)}<option value={place.id}>{place.label}</option>{/each}
                </select>
              </label>
            </div>

            <div class="segmented" role="group" aria-label="Quand afficher le trajet">
              <button type="button" class:on={c.mode === 'school'} aria-pressed={c.mode === 'school'} onclick={() => ((c.mode = 'school'), edit())}>Selon l’emploi du temps</button>
              <button type="button" class:on={c.mode === 'window'} aria-pressed={c.mode === 'window'} onclick={() => ((c.mode = 'window'), edit())}>Plage fixe</button>
            </div>

            <div class="days">
              {#each WEEK as { day, short, name } (day)}
                <button type="button" class="day" class:on={c.days.includes(day)} aria-pressed={c.days.includes(day)} aria-label="Le {name}" onclick={() => ((c.days = toggleDay(c.days, day)), edit())}>{short}</button>
              {/each}
            </div>

            {#if c.mode === 'school'}
              <div class="settings">
                <label>Arriver <input type="number" min="0" max="60" value={c.arriveBefore} oninput={(e) => setMinutes(c, 'arriveBefore', e.currentTarget.value)} /> min avant le 1er cours</label>
                <label>Carte affichée <input type="number" min="5" max="120" value={c.showBefore} oninput={(e) => setMinutes(c, 'showBefore', e.currentTarget.value)} /> min avant de partir</label>
              </div>
              <p class="muted small">La course est choisie chaque jour d’après le premier cours non annulé ; rien les jours sans cours.</p>
            {:else}
              <div class="settings">
                <label>
                  Affiché de
                  <input type="time" bind:value={c.window.from} oninput={edit} />
                  à
                  <input type="time" bind:value={c.window.to} oninput={edit} />
                </label>
              </div>
            {/if}

            <h3>Ligne <span class="muted small">(directe, sans changement)</span></h3>
            {#if routesError}
              <p class="muted">{routesError}</p>
            {:else if routes === null && placeOf(c.from) !== placeOf(c.to)}
              <p class="muted">Recherche des lignes…</p>
            {:else if choices.length === 0}
              <p class="muted">Aucune ligne directe entre ces deux lieux (arrêts à moins de 800 m).</p>
            {/if}
            {#each choices as option (routeKey(option))}
              {@const on = c.route !== null && routeKey(c.route) === routeKey(option)}
              <button type="button" class="option" class:on aria-pressed={on} onclick={() => chooseRoute(c, option)}>
                <span class="line" class:tram={isTram(option.line)}>{option.line}</span>
                <span class="grow">
                  {option.originName} → {option.destinationName}
                  <span class="muted small">vers {option.towards}</span>
                  <span class="muted small block">
                    {option.walkFrom} min à pied · {option.rideMinutes} min de {isTram(option.line) ? 'tram' : 'bus'} · {option.walkTo} min à pied · {option.totalMinutes} min en tout
                  </span>
                </span>
                {#if on}<Icon name="check" size={26} />{/if}
              </button>
            {/each}

            {#if c.route}
              <h3>À pied</h3>
              {@render walk(c, 'walkFrom', `${placeOf(c.from)?.label ?? 'Départ'} → ${c.route.originName}`, c.route.walkFrom)}
              {@render walk(c, 'walkTo', `${c.route.destinationName} → ${placeOf(c.to)?.label ?? 'Arrivée'}`, c.route.walkTo)}
              <p class="muted small">Estimé d’après la distance ; ton temps chronométré est plus juste.</p>
            {/if}

            <button type="button" class="link danger" onclick={removeCommute}>Supprimer le trajet de {nameOf(selected)}</button>
          {/if}
        </section>
      </div>
      {#if !draft.saved}
        <p class="muted small">Pas encore enregistré : les arrêts et le trajet du fichier de configuration s’appliquent jusque-là.</p>
      {/if}
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
  .transit-page {
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
    margin: 0 0 8px;
    font-size: 1.4rem;
    font-weight: 600;
  }

  h3 {
    margin: 14px 0 4px;
    font-size: 1.2rem;
    font-weight: 600;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .muted {
    font-size: 1.1rem;
    color: var(--fg-muted);
  }

  .small {
    font-size: 1rem;
    font-weight: 400;
  }

  .block {
    display: block;
  }

  p {
    margin: 6px 0;
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

  input,
  select {
    box-sizing: border-box;
    height: 48px;
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 1.15rem;
    user-select: text;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: var(--rain);
  }

  input[type='number'] {
    width: 80px;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    gap: 18px;
    align-items: start;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 18px 20px;
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--surface-2);
    font-size: 1.15rem;
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  .icon,
  .remove {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    color: var(--fg-muted);
  }

  .icon {
    background: var(--surface-2);
    color: var(--fg);
  }

  .place {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .place .label {
    height: 42px;
  }

  .address {
    overflow: hidden;
    padding: 0 2px;
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 1rem;
    color: var(--fg-muted);
  }

  .pill {
    flex-shrink: 0;
    padding: 4px 10px;
    border-radius: 14px;
    background: var(--surface-2);
    font-size: 0.95rem;
    color: var(--fg-muted);
  }

  .search {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }

  .search input {
    flex: 1 1 200px;
    min-width: 0;
  }

  .result,
  .option {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 52px;
    padding: 8px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    text-align: left;
    font-size: 1.15rem;
  }

  .option.on {
    border: 2px solid var(--rain);
    background: var(--rain-bg);
  }

  .lines {
    display: flex;
    gap: 4px;
  }

  .line {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    min-width: 34px;
    height: 32px;
    padding: 0 6px;
    box-sizing: border-box;
    border-radius: 8px;
    background: var(--rain-bg);
    color: var(--rain-soft);
    font-weight: 700;
  }

  .line.tram {
    background: #3a1f30;
    color: #f4b8d6;
  }

  .secondary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    padding: 0 16px;
    border-radius: 12px;
    background: var(--surface-2);
    font-size: 1.05rem;
    font-weight: 600;
  }

  .add {
    align-self: flex-start;
    margin-top: 8px;
  }

  .link {
    align-self: flex-start;
    padding: 6px 0;
    color: var(--rain-soft);
    font-size: 1rem;
  }

  .link.danger {
    margin-top: 14px;
    color: var(--danger-fg);
  }

  .members {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 8px;
  }

  .member {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 22px;
    border: 1px solid var(--border-strong);
    border-radius: 26px;
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--fg-soft);
  }

  .member.on {
    border-color: var(--member);
    background: color-mix(in srgb, var(--member) 22%, transparent);
    color: var(--fg);
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--member);
  }

  .ends {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .ends label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .segmented {
    display: inline-flex;
    align-self: flex-start;
    margin-top: 10px;
    padding: 4px;
    border-radius: 16px;
    background: var(--surface-2);
  }

  .segmented button {
    min-height: 46px;
    padding: 0 18px;
    border-radius: 12px;
    color: var(--fg-muted);
    font-size: 1.1rem;
    font-weight: 600;
  }

  .segmented button.on {
    background: var(--bg);
    color: var(--fg);
  }

  .days {
    display: flex;
    gap: 4px;
    margin-top: 8px;
  }

  .day {
    width: 40px;
    height: 44px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 600;
    color: var(--fg-muted);
  }

  .day.on {
    border-color: var(--rain);
    background: var(--rain-bg);
    color: var(--rain-soft);
  }

  .settings {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    margin-top: 8px;
    font-size: 1.15rem;
  }

  .settings label,
  .walk {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .walk {
    font-size: 1.15rem;
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

  .primary {
    min-height: 56px;
    padding: 0 30px;
    border-radius: 16px;
    background: var(--rain);
    color: #fff;
    font-size: 1.2rem;
    font-weight: 700;
  }
</style>
