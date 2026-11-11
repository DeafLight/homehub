<script lang="ts">
  import type { SchoolLife } from '../../../../shared/types.ts';
  import type { Profile } from '../../lib/profiles.ts';
  import { attendanceStatus, attendanceTitle, gradeParts, messageDayText, pastDayText } from '../../lib/school-life.ts';
  import Avatar from '../Avatar.svelte';

  // Détail de la vie scolaire, ouvert depuis le bloc : par enfant, les notes récentes et les absences et retards ; puis
  // les messages reçus (objet seulement : on les lit dans l'appli du service). `stacked` : une colonne (téléphone).
  type Props = { life: SchoolLife; profiles: Profile[]; now: Date; stacked?: boolean };
  let { life, profiles, now, stacked = false }: Props = $props();

  const profileOf = (id: string) => profiles.find((p) => p.id === id);
</script>

<div class="detail" class:stacked>
  {#each life.children as child (child.ownerId)}
    {@const profile = profileOf(child.ownerId)}
    <section>
      <h3>{#if profile}<Avatar {profile} size={32} />{/if} Notes récentes{profile ? ` · ${profile.name}` : ''}</h3>
      {#if child.grades === null}
        <p class="muted">Notes indisponibles pour l’instant.</p>
      {:else if child.grades.length === 0}
        <p class="muted">Pas encore de note.</p>
      {:else}
        <ul>
          {#each child.grades as grade (grade.id)}
            {@const parts = gradeParts(grade)}
            <li>
              <span class="what">
                <span>{grade.subject}</span>
                <span class="muted">{pastDayText(grade.date, now)}{grade.title ? ` · ${grade.title}` : ''}{grade.coefficient ? ` · coef. ${grade.coefficient}` : ''}</span>
              </span>
              <span class="value">
                <span><strong>{parts.value}</strong>{parts.outOf}</span>
                {#if grade.classAverage}<span class="muted">classe {grade.classAverage}</span>{/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
    <section>
      <h3>Absences et retards{profile ? ` · ${profile.name}` : ''}</h3>
      {#if child.attendance === null}
        <p class="muted">Vie scolaire indisponible pour l’instant.</p>
      {:else if child.attendance.length === 0}
        <p class="muted">Ni absence ni retard.</p>
      {:else}
        <ul>
          {#each child.attendance as item (item.id)}
            <li>
              <span class="what">
                <span>{attendanceTitle(item)}</span>
                <span class="muted" class:warn={!item.justified}>{attendanceStatus(item)}</span>
              </span>
              <span class="muted">{pastDayText(item.date, now)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
  {#each life.messages as inbox (inbox.service)}
    <section>
      <h3>Messages · {inbox.service}</h3>
      {#if inbox.items.length === 0}
        <p class="muted">Aucun message reçu.</p>
      {:else}
        <ul>
          {#each inbox.items as message (message.id)}
            <li class:unread={!message.read}>
              <span class="what">
                <span class="subject">{#if !message.read}<span class="dot" aria-label="Non lu"></span>{/if}{message.subject}</span>
                <span class="muted">{message.from}</span>
              </span>
              <span class="muted">{messageDayText(message.date, now, true)}</span>
            </li>
          {/each}
        </ul>
        <p class="hint">À lire dans {inbox.service} : l’ouvrir ici le marquerait lu.</p>
      {/if}
    </section>
  {/each}
</div>

<style>
  .detail {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--space-3) var(--space-4);
  }

  .detail.stacked {
    grid-template-columns: minmax(0, 1fr);
  }

  section {
    min-width: 0;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 var(--space-1);
    font-size: var(--text-body);
    font-weight: 600;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--surface-2);
    font-size: var(--text-body);
  }

  .what,
  .value {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .value {
    align-items: flex-end;
    white-space: nowrap;
    color: var(--fg-soft);
  }

  .value strong {
    color: var(--fg);
  }

  .muted {
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .warn {
    color: var(--warn);
  }

  li:not(.unread) .subject {
    color: var(--fg-soft);
  }

  .unread .subject {
    font-weight: 600;
  }

  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 8px;
    border-radius: 50%;
    background: var(--rain);
  }

  .hint {
    margin: var(--space-1) 0 0;
    font-size: var(--text-small);
    color: var(--fg-muted);
  }
</style>
