<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { FAMILY_ID, WEEKS_AHEAD } from '../../../shared/types.ts';
  import Icon from '../components/Icon.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import { mix, TOKENS } from '../lib/color.ts';
  import { getAppContext } from '../lib/context.ts';
  import { timelinePercent } from '../lib/day.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import type { PageRoute } from '../lib/route.ts';
  import { allDayShown, initialOwners, weekdayShort, weekDays, weekHours, weekOffsetLabel, weekRangeLabel } from '../lib/week.ts';

  const WEEK_REFRESH_MS = 5 * 60_000;
  /** Hauteur d'une ligne de texte dans un bloc (px), pour couper proprement à la dernière ligne entière. */
  const BLOCK_LINE_PX = 19;
  const BLOCK_PADDING_PX = 6;

  // Semaine détaillée en grille (piste A, docs/design.md) : 7 colonnes, agendas en couleur du profil, cours un par un
  // comme les événements ; deux bandeaux « journée entière » au plus par jour, la grille garde sa hauteur.
  // `back` est la page qui l'a ouverte : elle choisit aussi les profils affichés au départ.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, profiles, clock } = getAppContext();
  // App.svelte recrée cet écran quand la page d'origine change ({#key}) : elle est fixe ici.
  const fromOwner = untrack(() => (back.name === 'dashboard' ? back.ownerId : null));
  const fromProfile = profiles.find((p) => p.id === fromOwner && !p.isFamily);

  let offset = $state(0);
  let owners = $state(initialOwners(profiles.map((p) => p.id), fromOwner, FAMILY_ID));
  // Depuis un profil, ses cours sont utiles ; depuis l’accueil, ceux de tout le monde chargeraient la grille.
  let showCourses = $state(fromProfile !== undefined);

  const week = createResource(() => api.week(offset), WEEK_REFRESH_MS);
  onDestroy(week.destroy);

  // Une réponse d'une autre semaine (changement rapide) n'est pas affichée.
  const data = $derived(week.data?.offset === offset ? week.data : null);
  const hasCourses = $derived(data?.owners.some((o) => o.courses !== null) ?? false);
  const days = $derived(data ? weekDays(data, { owners, courses: showCourses }) : []);
  const hours = $derived(weekHours(days));
  const marks = $derived.by(() => {
    const result: number[] = [];
    for (let h = hours.startHour; h <= hours.endHour; h += 2) result.push(h);
    return result;
  });
  const colorOf = (ownerId: string) => profiles.find((p) => p.id === ownerId)?.color ?? TOKENS.fgMuted;
  const top = (date: Date) => timelinePercent(date, hours.startHour, hours.endHour);
  const markTop = (hour: number) => ((hour - hours.startHour) / (hours.endHour - hours.startHour)) * 100;
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const nowVisible = $derived(clock.now.getHours() >= hours.startHour && clock.now.getHours() < hours.endHour);
  const accent = fromProfile?.color ?? 'var(--fg)';
  const hasAllDay = $derived(days.some((d) => d.allDay.length > 0));

  let gridHeight = $state(0);
  const lines = (start: Date, end: Date) =>
    Math.max(1, Math.floor((((top(end) - top(start)) / 100) * gridHeight - BLOCK_PADDING_PX) / BLOCK_LINE_PX));

  function goTo(next: number) {
    offset = Math.min(WEEKS_AHEAD, Math.max(0, next));
    void week.refresh();
  }

  function toggle(ownerId: string) {
    const next = new Set(owners);
    if (next.has(ownerId)) next.delete(ownerId);
    else next.add(ownerId);
    owners = next;
  }
</script>

<div class="week-page">
  <PageHeader {back} title={fromProfile ? `Semaine de ${fromProfile.name}` : 'Semaine de la famille'} subtitle={data ? weekRangeLabel(new Date(data.start)) : null}>
    <nav class="week-nav" aria-label="Semaines">
      <button class="round" type="button" aria-label="Semaine précédente" disabled={offset === 0} onclick={() => goTo(offset - 1)}>
        <Icon name="back" size={28} strokeWidth={2} />
      </button>
      <button class="current" type="button" onclick={() => goTo(0)}>{weekOffsetLabel(offset)}</button>
      <button class="round" type="button" aria-label="Semaine suivante" disabled={offset === WEEKS_AHEAD} onclick={() => goTo(offset + 1)}>
        <Icon name="chevron" size={28} strokeWidth={2} />
      </button>
    </nav>
  </PageHeader>

  <div class="chips">
    {#each profiles as profile (profile.id)}
      {@const on = owners.has(profile.id)}
      <button
        class="chip"
        class:on
        type="button"
        aria-pressed={on}
        style:background={on ? mix(profile.color, TOKENS.bg, 0.28) : undefined}
        style:border-color={on ? profile.color : undefined}
        onclick={() => toggle(profile.id)}
      >
        <span class="dot" style:background={profile.color}></span>
        {profile.name}
      </button>
    {/each}
    {#if hasCourses}
      <span class="separator"></span>
      <button class="chip school" class:on={showCourses} type="button" aria-pressed={showCourses} onclick={() => (showCourses = !showCourses)}>
        <Icon name="school" size={20} />
        Cours
      </button>
    {/if}
  </div>

  <section class="grid">
    {#if data}
      <div class="row head">
        <span class="axis"></span>
        {#each days as day (day.date.getTime())}
          {@const today = sameDay(day.date, clock.now)}
          <div class="day-head">
            <span class="weekday card-label">{weekdayShort(day.date)}</span>
            <span class="num" class:today style:background={today ? accent : undefined}>{day.date.getDate()}</span>
          </div>
        {/each}
      </div>
      {#if hasAllDay}
        <div class="row all-day">
          <span class="axis"></span>
          {#each days as day (day.date.getTime())}
            {@const { shown, more } = allDayShown(day.allDay)}
            <div class="all-day-col">
              {#each shown as item, i (item.id)}
                <span class="all-day-line">
                  <span class="all-day-item" style:background={colorOf(item.ownerId)}>{item.title}</span>
                  {#if more > 0 && i === shown.length - 1}
                    <span class="all-day-more" aria-label="{more} de plus">+{more}</span>
                  {/if}
                </span>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
      <div class="row body">
        <div class="axis hours" aria-hidden="true">
          {#each marks as hour (hour)}
            <span style:top="{markTop(hour)}%">{hour} h</span>
          {/each}
        </div>
        <div class="columns" bind:clientHeight={gridHeight}>
          {#each marks as hour (hour)}
            <div class="line" style:top="{markTop(hour)}%"></div>
          {/each}
          {#each days as day (day.date.getTime())}
            {@const today = sameDay(day.date, clock.now)}
            <div class="column" class:today>
              {#each day.blocks as block (block.id)}
                {@const color = colorOf(block.ownerId)}
                {@const n = lines(block.start, block.end)}
                <div
                  class="block {block.kind}"
                  class:past={block.end <= clock.now}
                  class:cancelled={block.cancelled}
                  style:top="{top(block.start)}%"
                  style:height="calc({top(block.end) - top(block.start)}% - 3px)"
                  style:left="calc({(block.lane / block.lanes) * 100}% + 1px)"
                  style:width="calc({100 / block.lanes}% - 2px)"
                  style:border-left-color={color}
                  style:background={block.kind === 'event' ? mix(color, TOKENS.surface, 0.32) : undefined}
                >
                  <span class="block-text" class:single={n === 1} style:--lines={n} style:max-height="{n * BLOCK_LINE_PX}px">
                    <!-- Heure puis titre sur une même ligne, qui se replie si le bloc est assez haut ; la salle d'un cours ensuite. -->
                    <span class="block-time" style:color={block.kind === 'event' ? mix(color, TOKENS.white, 0.5) : undefined}>{block.meta}</span>
                    <span class="block-title">{block.title}</span>
                    {#if block.cancelled}
                      <span class="block-detail">annulé</span>
                    {:else if block.detail}
                      <span class="block-detail">· {block.detail}</span>
                    {/if}
                  </span>
                </div>
              {/each}
              {#if today && nowVisible}
                <div class="now" style:top="{top(clock.now)}%" style:background={fromProfile?.color ?? 'var(--sun)'}></div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {:else if week.error}
      <p class="muted">Impossible de charger la semaine : {week.error}</p>
    {/if}
  </section>
</div>

<style>
  .week-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    box-sizing: border-box;
  }

  .muted {
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  button {
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .week-nav {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .round {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--surface-2);
  }

  .round:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .current {
    min-height: 64px;
    padding: 0 var(--space-3);
    border-radius: 999px;
    background: var(--surface-2);
    font-size: var(--text-body);
    font-weight: 600;
  }

  .chips {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 20px 0 16px;
    box-sizing: border-box;
    border: 2px solid var(--surface-2);
    border-radius: 999px;
    background: transparent;
    color: var(--fg-muted);
    font-size: var(--text-small);
    font-weight: 600;
  }

  .chip.on {
    color: var(--fg);
  }

  .chip:not(.on) .dot {
    opacity: 0.4;
  }

  .dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
  }

  .chip.school {
    border-style: dashed;
  }

  .chip.school.on {
    background: var(--surface-2);
    border-color: var(--border-strong);
  }

  .separator {
    width: 2px;
    height: 32px;
    margin: 0 6px;
    background: var(--surface-2);
  }

  /* Carte de la piste A ; un peu moins de marge à gauche, que l'axe des heures occupe déjà. */
  .grid {
    flex-grow: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-1);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .row {
    display: flex;
    gap: 6px;
  }

  .axis {
    width: 50px;
    flex-shrink: 0;
  }

  .day-head,
  .all-day-col,
  .column {
    flex: 1 1 0;
    min-width: 0;
  }

  .day-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .num {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: var(--text-body);
    font-weight: 700;
  }

  .num.today {
    color: var(--bg);
  }

  .head,
  .all-day {
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--surface-2);
  }

  .all-day {
    padding-top: var(--space-1);
  }

  .all-day-col {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .all-day-line {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .all-day-item {
    flex: 1 1 auto;
    min-width: 0;
    padding: 4px 10px;
    border-radius: 8px;
    color: var(--bg);
    font-size: 0.9rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .all-day-more {
    flex-shrink: 0;
    padding: 4px 8px;
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--fg-soft);
    font-size: 0.9rem;
    font-weight: 700;
  }

  .body {
    position: relative;
    flex-grow: 1;
    min-height: 0;
    margin-top: 12px;
    margin-bottom: var(--space-1);
  }

  .hours {
    position: relative;
  }

  .hours span {
    position: absolute;
    right: 4px;
    transform: translateY(-50%);
    font-size: 0.9rem;
    color: var(--fg-muted);
  }

  .columns {
    position: relative;
    flex-grow: 1;
    display: flex;
    gap: 6px;
  }

  .line {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--surface-2);
  }

  .column {
    position: relative;
    border-radius: var(--radius-sm);
  }

  .column.today {
    background: var(--surface-1);
  }

  .block {
    position: absolute;
    min-height: 24px;
    box-sizing: border-box;
    padding: 3px 8px;
    border-left: 4px solid;
    border-radius: 10px;
    overflow: hidden;
  }

  .block.course {
    background: var(--surface-1);
    border-top: 1px dashed var(--border-strong);
    border-right: 1px dashed var(--border-strong);
    border-bottom: 1px dashed var(--border-strong);
  }

  .block-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--lines);
    line-clamp: var(--lines);
    overflow: hidden;
    line-height: 19px;
  }

  /* Une seule ligne : le titre est tronqué plutôt que renvoyé à une ligne invisible. */
  .block-text.single {
    display: block;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .block-time {
    margin-right: 6px;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .block-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--fg);
    overflow-wrap: anywhere;
  }

  .course .block-time,
  .block-detail {
    font-size: 0.82rem;
    color: var(--fg-muted);
  }

  .course .block-title {
    font-weight: 600;
    color: var(--fg-soft);
  }

  .cancelled .block-title {
    text-decoration: line-through;
  }

  .cancelled {
    opacity: 0.6;
  }

  .past {
    opacity: 0.5;
  }

  .now {
    position: absolute;
    left: -4px;
    right: 0;
    height: 3px;
    border-radius: 2px;
  }
</style>
