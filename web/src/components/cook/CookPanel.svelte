<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { CookAnswer, CookLine, CookProposal, CookResult, Estimate } from '../../../../shared/cook.ts';
  import { ESTIMATES, estimateLabel, needLabel } from '../../../../shared/cook.ts';
  import { localDay } from '../../../../shared/dates.ts';
  import { MENU_LIMITS } from '../../../../shared/menu.ts';
  import { getAppContext } from '../../lib/context.ts';
  import {
    allAsProposed,
    answerButtons,
    asksEstimate,
    buttonOf,
    type Choice,
    cookedLabel,
    type CookTarget,
    hintText,
    mealText,
    productText,
    proposable,
    repliesOf,
    stockChanges,
    undoText,
  } from '../../lib/cook.ts';
  import Icon from '../Icon.svelte';

  // Panneau « J'ai cuisiné » (tablette et téléphone) : la recette, le repas du menu (« changer », ou hors menu), le
  // nombre de personnes (la proposition suit, les réponses restent), une ligne par ingrédient où rien n'est choisi
  // d'avance (la proposition est écrite et son bouton entouré de bleu), « Tout comme proposé », puis « Retirer du stock
  // (N) » ou « Ne rien retirer » (le repas est noté cuisiné, les ingrédients sans réponse comptent encore). Le serveur
  // recalcule et vérifie tout. Fermer ne change rien.
  type Props = {
    target: CookTarget;
    phone?: boolean;
    /** Fini : le résultat du décompte, ou null (fermé sans rien changer). */
    onDone: (result: CookResult | null) => void;
    /** « Relier un produit » (fenêtre des liens du menu) ; absent : pas de lien. */
    onLink?: () => void;
  };
  let { target, phone = false, onDone, onLink }: Props = $props();

  const { api, clock, config } = getAppContext();
  const nameOf = (id: string | null) => (id ? (config.members.find((m) => m.id === id)?.name ?? null) : null);
  const today = $derived(localDay(clock.now));
  const byRecipe = untrack(() => 'recipeId' in target);

  let proposal = $state<CookProposal | null>(null);
  let people = $state<number | null>(null);
  /** Repas choisi pour une recette : undefined, celui que le serveur prend d'office ; null, hors menu. */
  let meal = $state<string | null | undefined>(untrack(() => ('recipeId' in target ? target.entryId : target.entryId)));
  let choices = $state<Record<string, Choice>>({});
  let busy = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);

  async function load() {
    error = null;
    try {
      const t = untrack(() => target);
      const next = await api.cookProposal('recipeId' in t ? { recipeId: t.recipeId, entryId: meal } : { entryId: t.entryId }, people);
      proposal = next;
      people = next.people;
      if (byRecipe) meal = next.meal?.id ?? null;
    } catch (err) {
      error = (err as Error).message;
    }
  }
  onMount(() => void load());

  function setPeople(value: number) {
    people = Math.min(MENU_LIMITS.people, Math.max(1, value));
    void load();
  }

  function changeMeal(value: string) {
    meal = value === 'none' ? null : value;
    people = null;
    void load();
  }

  const stockLines = $derived(proposal?.lines.filter((l) => l.status === 'stock') ?? []);
  const absent = $derived(proposal?.lines.filter((l) => l.status === 'absent') ?? []);
  const untracked = $derived(proposal?.lines.filter((l) => l.status === 'untracked') ?? []);
  const pantry = $derived(proposal?.lines.filter((l) => l.status === 'pantry') ?? []);
  const replies = $derived(proposal ? repliesOf(proposal.lines, choices) : []);
  const changes = $derived(stockChanges(replies));
  const cooked = $derived(proposal?.meal?.cooked ?? null);

  const choiceOf = (line: CookLine): Choice => choices[line.key] ?? { option: 0, answer: null, counter: line.options[0]?.counter ?? 1 };

  function answer(line: CookLine, value: CookAnswer) {
    const current = choiceOf(line);
    const again = current.answer?.action === value.action;
    choices = { ...choices, [line.key]: { ...current, answer: again ? null : value } };
  }

  function setEstimate(line: CookLine, estimate: Estimate) {
    const current = choiceOf(line);
    if (current.answer?.action !== 'left') return;
    choices = { ...choices, [line.key]: { ...current, answer: { ...current.answer, estimate } } };
  }

  function setCounter(line: CookLine, value: number) {
    const current = choiceOf(line);
    const option = line.options[current.option];
    choices = { ...choices, [line.key]: { ...current, counter: Math.min(option.stock, Math.max(1, value)) } };
  }

  function setOption(line: CookLine, index: number) {
    choices = { ...choices, [line.key]: { option: index, answer: null, counter: line.options[index]?.counter ?? 1 } };
  }

  async function submit(withReplies: boolean) {
    if (!proposal || busy) return;
    busy = true;
    error = null;
    try {
      const entryId = proposal.meal?.id ?? null;
      const body = { entryId, people, replies: withReplies ? replies : [] };
      const result = proposal.recipeId && byRecipe ? await api.cook({ recipeId: proposal.recipeId }, body) : await api.cook({ entryId: entryId ?? '' }, body);
      onDone(result);
    } catch (err) {
      error = (err as Error).message;
      // Déjà noté (double appui, autre appareil) : le panneau le montre, avec « Annuler ».
      await load();
    } finally {
      busy = false;
    }
  }

  async function undoMeal() {
    const id = proposal?.meal?.id;
    if (!id || busy) return;
    busy = true;
    try {
      notice = undoText(await api.uncookMeal(id));
      error = null;
      await load();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  const primaryLabel = $derived(changes > 0 ? `Retirer du stock (${changes})` : replies.length > 0 || proposal?.missing ? 'Noter cuisiné' : 'Retirer du stock');
  const canSubmit = $derived(!!proposal && !cooked && (changes > 0 || (proposal.meal !== null && (replies.length > 0 || proposal.missing))));
</script>

<div class="overlay" class:phone role="presentation">
  <div class="panel" role="dialog" aria-modal="true" aria-label="J’ai cuisiné">
    <header>
      <div class="titles">
        <h2>{phone ? 'J’ai cuisiné' : `J’ai cuisiné · ${proposal?.title ?? ''}`}</h2>
        {#if proposal}
          <div class="sub">
            {#if phone}{`${proposal.title} · `}{/if}
            {#if byRecipe && (proposal.meals.some((m) => !m.cooked && m.id !== proposal?.meal?.id) || proposal.meal)}
              <select aria-label="Repas du menu" value={proposal.meal?.id ?? 'none'} onchange={(e) => changeMeal(e.currentTarget.value)}>
                {#each proposal.meals.filter((m) => !m.cooked || m.id === proposal?.meal?.id) as m (m.id)}
                  <option value={m.id}>{mealText(m, today)}</option>
                {/each}
                <option value="none">Hors menu</option>
              </select>
            {:else}
              {mealText(proposal.meal, today)}
            {/if}
            {#if !phone}<span>· rien ne part du stock sans ta réponse</span>{/if}
          </div>
        {/if}
      </div>
      {#if proposal && !proposal.missing && people !== null}
        <div class="people" aria-label="Personnes">
          <button type="button" class="round" aria-label="Une personne de moins" disabled={busy || people <= 1} onclick={() => setPeople((people ?? 1) - 1)}><Icon name="minus" size={22} /></button>
          <span>{people} {proposal.servingsUnit ?? 'pers.'}</span>
          <button type="button" class="round" aria-label="Une personne de plus" disabled={busy || people >= MENU_LIMITS.people} onclick={() => setPeople((people ?? 1) + 1)}><Icon name="plus" size={22} /></button>
        </div>
      {/if}
      <button type="button" class="round close" aria-label="Fermer sans rien changer" onclick={() => onDone(null)}><Icon name="close" size={24} /></button>
    </header>

    {#if cooked}
      <p class="done" role="status">
        <Icon name="check" size={22} /> Déjà noté : {cookedLabel(cooked, today, nameOf).replace('Cuisiné · ', 'par ').replace('Cuisiné, ', '')}
        <button type="button" class="btn small" disabled={busy} onclick={undoMeal}><Icon name="undo" size={20} /> Annuler</button>
      </p>
    {/if}
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}

    <div class="lines">
      {#if proposal?.missing}
        <p class="muted">Recette retirée du carnet : le repas sera seulement noté cuisiné.</p>
      {/if}
      {#each stockLines as line (line.key)}
        {@const choice = choiceOf(line)}
        {@const option = line.options[choice.option]}
        {@const buttons = answerButtons(option, choice.counter)}
        {@const chosen = buttonOf(buttons, choice.answer)}
        <div class="line">
          <div class="info">
            <div class="what">{line.name} {#if needLabel(line)}<span class="qty">{needLabel(line)}</span>{/if}</div>
            {#if line.options.length > 1}
              <select class="product" aria-label="Produit pour {line.name}" value={choice.option} onchange={(e) => setOption(line, Number(e.currentTarget.value))}>
                {#each line.options as o, i (i)}<option value={i}>{productText(o)}</option>{/each}
              </select>
            {:else}
              <div class="product">{productText(option)}</div>
            {/if}
            {#if hintText(line, option)}<div class="hint">{hintText(line, option)}</div>{/if}
          </div>
          <div class="answers">
            {#if option.kind === 'count'}
              <span class="stepper">
                <button type="button" class="round" aria-label="Un paquet de moins" disabled={choice.counter <= 1} onclick={() => setCounter(line, choice.counter - 1)}><Icon name="minus" size={20} /></button>
                <span>{choice.counter}</span>
                <button type="button" class="round" aria-label="Un paquet de plus" disabled={choice.counter >= option.stock} onclick={() => setCounter(line, choice.counter + 1)}><Icon name="plus" size={20} /></button>
              </span>
            {/if}
            {#each buttons as b (b.id)}
              <button type="button" class="btn small answer" class:suggested={b.suggested} class:chosen={chosen === b.id} aria-pressed={chosen === b.id} onclick={() => answer(line, b.answer)}>
                {#if chosen === b.id}<Icon name="check" size={18} />{/if}{b.label}
              </button>
            {/each}
            {#if asksEstimate(option, choice.answer) && choice.answer?.action === 'left'}
              {@const estimate = choice.answer.estimate}
              <span class="estimates" role="group" aria-label="Il en reste à peu près">
                <span class="muted">à peu près</span>
                {#each ESTIMATES as e (e)}
                  <button type="button" class="chip" class:on={estimate === e} aria-pressed={estimate === e} onclick={() => setEstimate(line, e)}>{estimateLabel(e)}</button>
                {/each}
              </span>
            {/if}
          </div>
        </div>
      {/each}
      {#each absent as line (line.key)}
        <div class="line quiet">
          <div class="info">
            <div class="what">{line.name} {#if needLabel(line)}<span class="qty">{needLabel(line)}</span>{/if}</div>
            <div class="product">{line.linked.join(', ')} · pas en stock d’après HomeHub</div>
          </div>
        </div>
      {/each}
      {#if untracked.length}
        <div class="untracked">
          Pas suivis dans le stock : {untracked.map((l) => l.name.toLowerCase()).join(', ')}
          {#if onLink}<button type="button" class="link" onclick={onLink}>Relier un produit</button>{/if}
        </div>
      {/if}
      {#if pantry.length}
        <div class="untracked">Placards ignorés : {pantry.map((l) => l.name.toLowerCase()).join(', ')}</div>
      {/if}
    </div>

    <footer>
      <span class="grow">
        {#if stockLines.length}{replies.length} réponse{replies.length > 1 ? 's' : ''} sur {stockLines.length}{/if}{#if proposal?.meal && !cooked}{`${stockLines.length ? ' · ' : ''}le repas sera noté cuisiné`}{/if}
      </span>
      {#if proposal && proposable(proposal.lines, choices)}
        <button type="button" class="btn" disabled={busy || !!cooked} onclick={() => (choices = allAsProposed(proposal!.lines, choices))}>Tout comme proposé</button>
      {/if}
      {#if proposal?.meal && !cooked}
        <button type="button" class="btn" disabled={busy} onclick={() => submit(false)}>Ne rien retirer</button>
      {/if}
      <button type="button" class="btn primary" disabled={busy || !canSubmit} onclick={() => submit(true)}>{primaryLabel}</button>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    padding: var(--space-4) 120px;
    box-sizing: border-box;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
  }

  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    border-radius: var(--radius-xl);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--border-strong);
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-2);
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: var(--text-title);
    overflow-wrap: anywhere;
  }

  .sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  select {
    min-height: 40px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-small);
  }

  .people,
  .stepper {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-body);
    font-weight: 600;
    white-space: nowrap;
  }

  .round {
    display: grid;
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
  }

  .round:disabled {
    opacity: 0.4;
  }

  .stepper .round {
    width: 44px;
    height: 44px;
  }

  .done,
  .notice,
  .error {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0 var(--space-3) var(--space-1);
    font-size: var(--text-small);
  }

  .done {
    padding: 6px 6px 6px 14px;
    border-radius: var(--radius-sm);
    background: var(--ok-bg);
    color: var(--ok-fg);
  }

  .notice {
    color: var(--fg-soft);
  }

  .error {
    color: var(--danger-fg);
  }

  .lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    padding: 0 var(--space-3);
    overflow-y: auto;
  }

  .line {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px var(--space-2);
    align-items: center;
    padding: 14px 0;
    border-top: 1px solid var(--surface-2);
  }

  .line.quiet {
    opacity: 0.7;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .what {
    font-size: var(--text-body);
    font-weight: 600;
  }

  .qty {
    color: var(--rain-soft);
    font-weight: 500;
  }

  .product {
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  select.product {
    align-self: flex-start;
    max-width: 100%;
  }

  .hint {
    font-size: var(--text-small);
    color: var(--fg-soft);
  }

  .answers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
    justify-content: flex-end;
  }

  /* La proposition : entourée de bleu, jamais choisie d'avance ; la réponse choisie est pleine. */
  .answer.suggested {
    box-shadow: inset 0 0 0 2px var(--rain);
  }

  .answer.chosen {
    background: var(--rain);
    color: var(--bg);
  }

  .estimates {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    justify-content: flex-end;
  }

  .chip {
    min-width: 48px;
    min-height: 40px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-body);
  }

  .chip.on {
    background: var(--rain-bg);
    color: var(--rain-soft);
    box-shadow: inset 0 0 0 2px var(--rain);
  }

  .untracked {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    padding: 12px 0;
    border-top: 1px solid var(--surface-2);
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .link {
    min-height: 36px;
    padding: 0 8px;
    border: 0;
    background: none;
    color: var(--rain-soft);
    font: inherit;
    font-weight: 600;
  }

  .muted {
    color: var(--fg-muted);
    font-size: var(--text-small);
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
    border-top: 1px solid var(--surface-2);
  }

  .grow {
    flex: 1;
    min-width: 0;
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  /* Téléphone : plein écran, lignes empilées. */
  .overlay.phone {
    padding: 0;
    background: var(--bg);
  }

  .phone .panel {
    border-radius: 0;
    box-shadow: none;
    background: var(--bg);
  }

  .phone header {
    flex-wrap: wrap;
    padding: calc(var(--space-2) + env(safe-area-inset-top)) 16px var(--space-1);
  }

  .phone .people {
    order: 3;
    width: 100%;
  }

  .phone .done,
  .phone .notice,
  .phone .error {
    margin: 0 16px var(--space-1);
  }

  .phone .lines {
    padding: 0 16px;
  }

  .phone .line {
    grid-template-columns: 1fr;
  }

  .phone .answers,
  .phone .estimates {
    justify-content: flex-start;
  }

  .phone footer {
    padding: var(--space-2) 16px calc(var(--space-2) + env(safe-area-inset-bottom));
  }

  .phone footer .grow {
    flex-basis: 100%;
  }

  .phone footer .btn.primary {
    flex: 1;
  }
</style>
