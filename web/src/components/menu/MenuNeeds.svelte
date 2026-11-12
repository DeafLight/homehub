<script lang="ts">
  import type { CheckDecision, PlanLine } from '../../../../shared/menu.ts';
  import { dayLabel, laterAmount, lineAmount, lineSources, lineStatus, planGroups } from '../../lib/menu.ts';

  // Courses du menu : ce qu'il reste à acheter, par rayon, avec les recettes d'où vient chaque ligne et ce qu'on en a
  // déjà (stock, déjà acheté) ; « J'en ai déjà » la retire de la liste pour la semaine. Puis ce qui n'est pas à
  // acheter (placards, en stock, coché, déjà sur la liste à la main). Ces lignes sont sur la liste de courses.
  // En tête, « À vérifier au placard » : un paquet peut-être entamé comblerait le manque ; tant qu'on n'a pas décidé
  // (« J'en ai assez » / « Il en faut »), la ligne reste dans les courses. « À acheter plus tard » : les frais d'un repas
  // tardif, avec le jour où ils rejoindront la liste ; « Acheter maintenant » les avance (« Plus tard » les remet).
  type Props = {
    plan: PlanLine[];
    editable: boolean;
    /** Texte quand le menu est vide. */
    empty: string;
    busy: boolean;
    onHave: (line: PlanLine, have: boolean) => void;
    onCheck: (line: PlanLine, decision: CheckDecision | null) => void;
    onNow: (line: PlanLine, now: boolean) => void;
  };
  let { plan, editable, empty, busy, onHave, onCheck, onNow }: Props = $props();

  const groups = $derived(planGroups(plan));
  /** Frais qui attendent, par jour d'achat. */
  const laterDays = $derived(
    groups.later.reduce<{ day: string; rows: typeof groups.later }[]>((days, row) => {
      const last = days.at(-1);
      if (last?.day === row.part.day) last.rows.push(row);
      else days.push({ day: row.part.day, rows: [row] });
      return days;
    }, []),
  );
</script>

{#if plan.length === 0}
  <p class="muted">{empty}</p>
{:else}
  <div class="needs">
    {#if groups.toCheck.length > 0}
      <section class="check" aria-label="À vérifier au placard">
        <h3>À vérifier au placard</h3>
        <p class="hint">Un paquet est peut-être entamé. Tant que personne n’a regardé, c’est dans les courses.</p>
        <ul>
          {#each groups.toCheck as line (line.key)}
            <li>
              <div class="what">
                <span class="name">{line.name}</span>
                <span class="amount">{lineAmount(line)}</span>
                <span class="sources">{lineSources(line)}</span>
                <span class="chip warn">{lineStatus(line)}</span>
              </div>
              {#if editable}
                <div class="decide">
                  <button type="button" class="btn small" disabled={busy} onclick={() => onCheck(line, 'enough')}>J’en ai assez</button>
                  <button type="button" class="btn small" disabled={busy} onclick={() => onCheck(line, 'needed')}>Il en faut</button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#each groups.toBuy as group (group.aisle)}
      <h3>{group.aisle}</h3>
      <ul>
        {#each group.items as line (line.key)}
          {@const status = lineStatus(line)}
          <li>
            <div class="what">
              <span class="name">{line.name}{#if line.optional}{' '}<span class="muted">(facultatif)</span>{/if}</span>
              <span class="amount">{lineAmount(line)}</span>
              <span class="sources">{lineSources(line)}</span>
              {#if status}<span class="chip" class:warn={line.stock?.enough === null}>{status}</span>{/if}
            </div>
            {#if editable && line.advanced}
              <button type="button" class="btn small" disabled={busy} onclick={() => onNow(line, false)}>Plus tard</button>
            {/if}
            {#if editable && line.check === 'needed'}
              <button type="button" class="btn small" disabled={busy} onclick={() => onCheck(line, 'enough')}>J’en ai assez</button>
            {:else if editable}
              <button type="button" class="btn small" disabled={busy} onclick={() => onHave(line, true)}>J’en ai déjà</button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      {#if groups.toCheck.length === 0 && groups.later.length === 0}<p class="muted">Rien à acheter pour ce menu.</p>{/if}
    {/each}

    {#if groups.later.length > 0}
      <section class="later" aria-label="À acheter plus tard">
        <h3>À acheter plus tard</h3>
        <p class="hint">Produits frais des repas plus lointains : ils rejoignent la liste trois jours avant le repas.</p>
        {#each laterDays as group (group.day)}
          <h4>{dayLabel(group.day)}</h4>
          <ul>
            {#each group.rows as { line, part } (`${line.key}|${part.day}`)}
              <li>
                <div class="what">
                  <span class="name">{line.name}</span>
                  <span class="amount">{laterAmount(part)}</span>
                  <span class="sources">{lineSources(part)}</span>
                </div>
                {#if editable}
                  <button type="button" class="btn small" disabled={busy} onclick={() => onNow(line, true)}>Acheter maintenant</button>
                {/if}
              </li>
            {/each}
          </ul>
        {/each}
      </section>
    {/if}

    {#if groups.covered.length > 0}
      <h3>Déjà à la maison</h3>
      <ul class="covered">
        {#each groups.covered as line (line.key)}
          <li>
            <div class="what">
              <span class="name">{line.name}</span>
              <span class="amount">{lineAmount(line)}</span>
              <span class="chip ok">{lineStatus(line)}</span>
            </div>
            {#if editable && line.status === 'have'}
              <button type="button" class="btn small" disabled={busy} onclick={() => onHave(line, false)}>À acheter</button>
            {:else if editable && line.check === 'enough'}
              <button type="button" class="btn small" disabled={busy} onclick={() => onCheck(line, 'needed')}>Il en faut</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .needs {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  h3 {
    margin: var(--space-1) 0 0;
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--fg-muted);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 56px;
    padding: 6px 0;
    border-bottom: 1px solid var(--surface-2);
  }

  li:last-child {
    border-bottom: 0;
  }

  .what {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    min-width: 0;
  }

  .name {
    font-size: var(--text-body);
    font-weight: 600;
  }

  .amount {
    font-size: var(--text-body);
    color: var(--rain-soft);
    font-variant-numeric: tabular-nums;
  }

  .sources {
    flex-basis: 100%;
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .chip {
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
    font-size: var(--text-small);
  }

  .chip.ok {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }

  .chip.warn {
    background: var(--warn-bg);
    color: var(--sun);
  }

  /* À vérifier au placard : encadré discret, la ligne reste dans les courses tant qu'on n'a pas décidé. */
  .check {
    padding: 4px var(--space-2) 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .check h3 {
    color: var(--sun);
  }

  .check .hint {
    margin: 2px 0 0;
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .check li {
    flex-direction: column;
    align-items: stretch;
    border-bottom-color: var(--surface);
  }

  .check .btn {
    background: var(--surface);
  }

  /* À acheter plus tard : en retrait, ce n'est pas encore sur la liste. */
  .later {
    padding: 4px var(--space-2) 6px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
  }

  .later .hint {
    margin: 2px 0 0;
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .later h4 {
    margin: var(--space-1) 0 0;
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--rain-soft);
  }

  .later .name {
    font-weight: 400;
    color: var(--fg-soft);
  }

  .decide {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .covered .name {
    font-weight: 400;
    color: var(--fg-soft);
  }

  .covered .amount {
    color: var(--fg-muted);
  }

  .muted {
    color: var(--fg-muted);
  }
</style>
