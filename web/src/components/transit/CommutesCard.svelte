<script lang="ts">
  import { untrack } from 'svelte';
  import type { CommuteSettings, RouteOption, TransitSettings } from '../../../../shared/types.ts';
  import type { Profile } from '../../lib/profiles.ts';
  import { type Api, ApiError } from '../../lib/api.ts';
  import { WEEK } from '../../lib/routine-edit.ts';
  import { isTram } from '../../lib/transit.ts';
  import { boundedMinutes, endsKey, newCommute, routeChoices, routeKey, toggleDay, walkMinutes } from '../../lib/transit-edit.ts';
  import Icon from '../Icon.svelte';

  // Carte « Trajets » de la page Transports : le trajet de chaque membre (départ, arrivée, jours, calé sur l'emploi
  // du temps ou sur une plage fixe), la ligne directe choisie parmi celles que proposent les horaires Irigo, et les
  // temps de marche. Modifie le brouillon de la page ; rien n'est enregistré ici.
  type Props = {
    draft: TransitSettings;
    api: Api;
    members: Profile[];
    nameOf: (id: string) => string;
    onEdit: () => void;
  };
  let { draft = $bindable(), api, members, nameOf, onEdit }: Props = $props();

  // Premier membre au départ ; la liste ne change pas pendant que la page est ouverte.
  let selected = $state(untrack(() => members[0]?.id ?? ''));
  const commute = $derived(draft.commutes[selected]);
  const placeOf = (id: string | undefined) => draft.places.find((p) => p.id === id);

  // Itinéraires entre les deux lieux du trajet affiché, recherchés quand ils changent.
  let routes = $state<RouteOption[] | null>(null);
  let routesError = $state<string | null>(null);
  let routesFor = '';
  $effect(() => {
    const from = placeOf(commute?.from);
    const to = placeOf(commute?.to);
    const key = endsKey(from, to);
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
  const choices = $derived(routeChoices(routes, commute?.route));

  function addCommute() {
    draft.commutes[selected] = newCommute(draft.places);
    onEdit();
  }

  function setPlace(c: CommuteSettings, end: 'from' | 'to', id: string) {
    c[end] = id;
    c.route = null;
    onEdit();
  }

  function chooseRoute(c: CommuteSettings, option: RouteOption) {
    const { totalMinutes: _, ...route } = option;
    c.route = route;
    onEdit();
  }

  function setWalk(c: CommuteSettings, end: 'walkFrom' | 'walkTo', value: string) {
    c[end] = walkMinutes(value);
    onEdit();
  }

  function setMinutes(c: CommuteSettings, field: 'arriveBefore' | 'showBefore', value: string) {
    const n = boundedMinutes(field, value);
    if (n !== null) c[field] = n;
    onEdit();
  }

  function removeCommute() {
    delete draft.commutes[selected];
    onEdit();
  }
</script>

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
      <button type="button" class="link" onclick={() => ((c[end] = null), onEdit())}>Revenir à l’estimation</button>
    {/if}
  </label>
{/snippet}

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
      <button type="button" class:on={c.mode === 'school'} aria-pressed={c.mode === 'school'} onclick={() => ((c.mode = 'school'), onEdit())}>Selon l’emploi du temps</button>
      <button type="button" class:on={c.mode === 'window'} aria-pressed={c.mode === 'window'} onclick={() => ((c.mode = 'window'), onEdit())}>Plage fixe</button>
    </div>

    <div class="days">
      {#each WEEK as { day, short, name } (day)}
        <button type="button" class="day" class:on={c.days.includes(day)} aria-pressed={c.days.includes(day)} aria-label="Le {name}" onclick={() => ((c.days = toggleDay(c.days, day)), onEdit())}>{short}</button>
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
          <input type="time" bind:value={c.window.from} oninput={onEdit} />
          à
          <input type="time" bind:value={c.window.to} oninput={onEdit} />
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

<style>
  h3 {
    margin: 14px 0 4px;
    font-size: 1.2rem;
    font-weight: 600;
  }

  .option.on {
    border: 2px solid var(--rain);
    background: var(--rain-bg);
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
</style>
