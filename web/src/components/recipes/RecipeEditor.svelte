<script lang="ts">
  import { untrack } from 'svelte';
  import { formatQuantity, UNITS, type Unit, unitLabel } from '../../../../shared/ingredients.ts';
  import type { IngredientLine, RecipeContent } from '../../../../shared/recipes.ts';
  import { cleanGroupName, groupNames, insertInGroup, moveGroup, moveInGroups, moveToGroup, removeGroup, renameGroup } from '../../lib/recipe-groups.ts';
  import { changeServings, contentProblem, correctLine, editLineText, groupBySection, linesFromText, newId } from '../../lib/recipes.ts';
  import Icon from '../Icon.svelte';

  // Édition de notre version (ou saisie à la main) : titre, portions par défaut (les quantités suivent, sauf si on
  // corrige seulement le chiffre), temps, Cookeo, ingrédients (chaque ligne réanalysée en direct ; « Ajuster » corrige
  // quantité, unité ou nom à la main, et la correction l'emporte), étapes et nos astuces. Ingrédients et étapes se
  // rangent en groupes (« Pour la pâte ») : créer, renommer, monter, retirer un groupe, y ranger une ligne ou l'en
  // sortir. La source n'est jamais touchée : elle reste consultable sur la fiche.
  type Props = {
    initial: RecipeContent;
    phone?: boolean;
    saving: boolean;
    error: string | null;
    onSave: (content: RecipeContent) => void;
    onCancel: () => void;
  };
  let { initial, phone = false, saving, error, onSave, onCancel }: Props = $props();

  let content = $state<RecipeContent>(untrack(() => structuredClone($state.snapshot(initial))));
  let followQuantities = $state(true);
  let adjusting = $state<string | null>(null);
  let newIngredients = $state('');
  let newStep = $state('');
  let problem = $state<string | null>(null);

  const UNIT_CHOICES = UNITS.filter((u) => u !== 'piece');

  function setServings(value: number) {
    if (!Number.isFinite(value) || value < 1 || value > 100) return;
    content = changeServings(content, Math.round(value), !followQuantities);
  }

  const updateLine = (id: string, line: IngredientLine) => (content.ingredients = content.ingredients.map((l) => (l.id === id ? line : l)));

  // --- Groupes (« Pour la pâte ») : le champ `section` des lignes, identifiants et ordre gardés (lib/recipe-groups). ---
  type Kind = 'ingredients' | 'steps';
  type Grouped = { id: string; section: string | null };
  /** Groupes créés mais encore vides : ils n'existent dans la recette qu'une fois une ligne rangée dedans. */
  let pending = $state<Record<Kind, string[]>>({ ingredients: [], steps: [] });
  let newGroup = $state<Record<Kind, string>>({ ingredients: '', steps: '' });
  /** Groupe où vont les lignes ajoutées ('' : sans groupe). */
  let addTo = $state<Record<Kind, string>>({ ingredients: '', steps: '' });

  function apply(kind: Kind, change: <T extends Grouped>(items: readonly T[]) => T[]) {
    if (kind === 'ingredients') content.ingredients = change(content.ingredients);
    else content.steps = change(content.steps);
  }
  const pendingOf = (kind: Kind) => pending[kind].filter((name) => !content[kind].some((x) => x.section === name));
  const namesOf = (kind: Kind) => [...groupNames(content[kind]), ...pendingOf(kind)];
  const indexOf = (kind: Kind, id: string) => content[kind].findIndex((x) => x.id === id);
  /** Groupe d'ajout encore valable (un groupe retiré ou renommé entre-temps : sans groupe). */
  const targetOf = (kind: Kind) => (namesOf(kind).includes(addTo[kind]) ? addTo[kind] : null);

  function createGroup(kind: Kind) {
    const name = cleanGroupName(newGroup[kind]);
    newGroup[kind] = '';
    if (!name) return;
    if (!namesOf(kind).includes(name)) pending[kind] = [...pending[kind], name];
    addTo[kind] = name;
  }

  function renameIn(kind: Kind, from: string, to: string) {
    const name = cleanGroupName(to);
    if (pending[kind].includes(from) && !content[kind].some((x) => x.section === from)) {
      pending[kind] = pending[kind].filter((n) => n !== from);
      if (name && !namesOf(kind).includes(name)) pending[kind] = [...pending[kind], name];
    } else {
      apply(kind, (items) => renameGroup(items, from, to));
    }
    if (addTo[kind] === from) addTo[kind] = name ?? '';
  }

  function removeIn(kind: Kind, name: string) {
    pending[kind] = pending[kind].filter((n) => n !== name);
    apply(kind, (items) => removeGroup(items, name));
  }

  const toGroup = (kind: Kind, id: string, value: string) => apply(kind, (items) => moveToGroup(items, id, value || null));

  function addIngredients() {
    const lines = linesFromText(newIngredients);
    if (lines.length === 0) return;
    content.ingredients = insertInGroup(content.ingredients, lines, targetOf('ingredients'));
    newIngredients = '';
  }

  function addStep() {
    const texts = newStep.split(/\n\s*\n/u).map((t) => t.trim()).filter(Boolean);
    if (texts.length === 0) return;
    content.steps = insertInGroup(content.steps, texts.map((text) => ({ id: newId(), text, section: null })), targetOf('steps'));
    newStep = '';
  }

  const minutesOf = (value: string) => {
    const n = Number(value);
    return value.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  function save() {
    // Ce qui est encore dans les zones d'ajout compte aussi.
    addIngredients();
    addStep();
    problem = contentProblem(content);
    if (!problem) onSave($state.snapshot(content) as RecipeContent);
  }

  const parsedText = (line: IngredientLine) =>
    [line.quantity !== null ? formatQuantity(line.quantity, line.unit) : null, line.unit && line.unit !== 'piece' ? unitLabel(line.unit, line.quantity ?? 1) : null, line.name].filter(Boolean).join(' · ');
</script>

<form class="editor" class:phone onsubmit={(e) => (e.preventDefault(), save())}>
  <section class="card">
    <label class="field">
      <span class="card-label">Titre</span>
      <input class="title" bind:value={content.title} maxlength="200" required />
    </label>

    <div class="row">
      <div class="field">
        <span class="card-label">Portions par défaut</span>
        <div class="stepper">
          <button type="button" aria-label="Une portion de moins" onclick={() => setServings((content.servings ?? 2) - 1)}><Icon name="minus" size={22} /></button>
          <input type="number" min="1" max="100" inputmode="numeric" aria-label="Portions" value={content.servings ?? ''} onchange={(e) => setServings(Number(e.currentTarget.value))} />
          <button type="button" aria-label="Une portion de plus" onclick={() => setServings((content.servings ?? 0) + 1)}><Icon name="plus" size={22} /></button>
        </div>
        <label class="check"><input type="checkbox" bind:checked={followQuantities} /> Les quantités suivent</label>
      </div>
      <label class="field">
        <span class="card-label">Portions en</span>
        <input bind:value={() => content.servingsUnit ?? '', (v) => (content.servingsUnit = v.trim() ? v : null)} placeholder="personnes" maxlength="40" />
      </label>
    </div>

    <div class="row times">
      <label class="field"><span class="card-label">Préparation (min)</span><input type="number" min="0" inputmode="numeric" value={content.prepMinutes ?? ''} onchange={(e) => (content.prepMinutes = minutesOf(e.currentTarget.value))} /></label>
      <label class="field"><span class="card-label">Cuisson (min)</span><input type="number" min="0" inputmode="numeric" value={content.cookMinutes ?? ''} onchange={(e) => (content.cookMinutes = minutesOf(e.currentTarget.value))} /></label>
      <label class="field"><span class="card-label">Total (min)</span><input type="number" min="0" inputmode="numeric" value={content.totalMinutes ?? ''} onchange={(e) => (content.totalMinutes = minutesOf(e.currentTarget.value))} /></label>
    </div>
    <label class="check"><input type="checkbox" checked={content.appliance === 'cookeo'} onchange={(e) => (content.appliance = e.currentTarget.checked ? 'cookeo' : null)} /> Recette au Cookeo</label>
  </section>

  {#snippet groupHead(kind: Kind, name: string, pending: boolean)}
    {@const names = groupNames(content[kind])}
    <div class="group-head">
      <input aria-label="Nom du groupe {name}" value={name} maxlength="120" onchange={(e) => renameIn(kind, name, e.currentTarget.value)} />
      <button type="button" class="icon up" aria-label="Monter le groupe {name}" disabled={pending || names.indexOf(name) <= 0} onclick={() => apply(kind, (items) => moveGroup(items, name, -1))}><Icon name="chevron" size={20} /></button>
      <button type="button" class="icon" aria-label="Retirer le groupe {name}" onclick={() => removeIn(kind, name)}><Icon name="close" size={20} /></button>
    </div>
    {#if pending}<p class="muted hint">Aucune ligne pour l’instant : range-en ici avec le choix du groupe de chaque ligne.</p>{/if}
  {/snippet}

  {#snippet groupChoice(kind: Kind, id: string, section: string | null, label: string)}
    {#if namesOf(kind).length}
      <select class="group-choice" aria-label={label} value={section ?? ''} onchange={(e) => toGroup(kind, id, e.currentTarget.value)}>
        <option value="">Sans groupe</option>
        {#each namesOf(kind) as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    {/if}
  {/snippet}

  {#snippet newGroupRow(kind: Kind)}
    <div class="new-group">
      <input
        aria-label={kind === 'ingredients' ? 'Nouveau groupe d’ingrédients' : 'Nouveau groupe d’étapes'}
        placeholder={kind === 'ingredients' ? 'Nouveau groupe (« Pour la pâte »)' : 'Nouveau groupe (« Cuisson »)'}
        maxlength="120"
        bind:value={newGroup[kind]}
        onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), createGroup(kind))}
      />
      <button type="button" class="btn small" onclick={() => createGroup(kind)}><Icon name="plus" size={20} /> Groupe</button>
    </div>
  {/snippet}

  {#snippet addTarget(kind: Kind)}
    {#if namesOf(kind).length}
      <label class="target">
        <span class="muted">dans</span>
        <select bind:value={addTo[kind]} aria-label={kind === 'ingredients' ? 'Groupe des ingrédients ajoutés' : 'Groupe des étapes ajoutées'}>
          <option value="">Sans groupe</option>
          {#each namesOf(kind) as name (name)}<option value={name}>{name}</option>{/each}
        </select>
      </label>
    {/if}
  {/snippet}

  <section class="card">
    <h2 class="card-label">Ingrédients</h2>
    {#each groupBySection(content.ingredients) as group, g (`${group.section}|${g}`)}
      <div class="group">
        {#if group.section !== null}
          {@render groupHead('ingredients', group.section, false)}
        {:else if namesOf('ingredients').length}
          <p class="card-label loose">Sans groupe</p>
        {/if}
        <ul class="lines">
          {#each group.items as line (line.id)}
            {@const i = indexOf('ingredients', line.id)}
            <li>
              <div class="line">
                <input aria-label="Ingrédient {i + 1}" value={line.text} maxlength="300" onchange={(e) => updateLine(line.id, editLineText(line, e.currentTarget.value))} />
                <button type="button" class="icon up" aria-label="Monter" disabled={i === 0} onclick={() => apply('ingredients', (items) => moveInGroups(items, i, -1))}><Icon name="chevron" size={20} /></button>
                <button type="button" class="icon" aria-label="Retirer" onclick={() => (content.ingredients = content.ingredients.filter((l) => l.id !== line.id))}><Icon name="close" size={20} /></button>
              </div>
              <div class="parsed">
                <span>{parsedText(line) || '—'}{line.manual ? ' · corrigé' : ''}</span>
                {@render groupChoice('ingredients', line.id, line.section, `Groupe de l’ingrédient ${i + 1}`)}
                <button type="button" class="link" onclick={() => (adjusting = adjusting === line.id ? null : line.id)}>{adjusting === line.id ? 'Fermer' : 'Ajuster'}</button>
              </div>
              {#if adjusting === line.id}
                <div class="adjust">
                  <label>Quantité <input type="number" min="0" step="any" inputmode="decimal" value={line.quantity ?? ''} onchange={(e) => updateLine(line.id, correctLine(line, { quantity: e.currentTarget.value.trim() ? Number(e.currentTarget.value) : null }))} /></label>
                  <label>Unité
                    <select value={line.unit ?? 'piece'} onchange={(e) => updateLine(line.id, correctLine(line, { unit: e.currentTarget.value as Unit }))}>
                      <option value="piece">pièce</option>
                      {#each UNIT_CHOICES as unit (unit)}<option value={unit}>{unitLabel(unit)}</option>{/each}
                    </select>
                  </label>
                  <label>Nom <input value={line.name} maxlength="300" onchange={(e) => updateLine(line.id, correctLine(line, { name: e.currentTarget.value.trim() || line.name }))} /></label>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
    {#each pendingOf('ingredients') as name (name)}
      <div class="group">{@render groupHead('ingredients', name, true)}</div>
    {/each}
    <label class="field">
      <span class="muted">Ajouter des ingrédients, un par ligne (« 2 gros oignons émincés », « sel, poivre »)</span>
      <textarea rows="2" bind:value={newIngredients}></textarea>
    </label>
    <div class="add">
      <button type="button" class="btn small" onclick={addIngredients}><Icon name="plus" size={20} /> Ajouter</button>
      {@render addTarget('ingredients')}
    </div>
    {@render newGroupRow('ingredients')}
  </section>

  <section class="card">
    <h2 class="card-label">Étapes</h2>
    {#each groupBySection(content.steps) as group, g (`${group.section}|${g}`)}
      <div class="group">
        {#if group.section !== null}
          {@render groupHead('steps', group.section, false)}
        {:else if namesOf('steps').length}
          <p class="card-label loose">Sans groupe</p>
        {/if}
        <ol class="lines">
          {#each group.items as step (step.id)}
            {@const i = indexOf('steps', step.id)}
            <li>
              <div class="line">
                <span class="number">{i + 1}</span>
                <textarea aria-label="Étape {i + 1}" rows="3" value={step.text} maxlength="2000" onchange={(e) => (content.steps = content.steps.map((s) => (s.id === step.id ? { ...s, text: e.currentTarget.value.trim() || s.text } : s)))}></textarea>
                <button type="button" class="icon up" aria-label="Monter" disabled={i === 0} onclick={() => apply('steps', (items) => moveInGroups(items, i, -1))}><Icon name="chevron" size={20} /></button>
                <button type="button" class="icon" aria-label="Retirer" onclick={() => (content.steps = content.steps.filter((s) => s.id !== step.id))}><Icon name="close" size={20} /></button>
              </div>
              {#if namesOf('steps').length}
                <div class="parsed">{@render groupChoice('steps', step.id, step.section, `Groupe de l’étape ${i + 1}`)}</div>
              {/if}
            </li>
          {/each}
        </ol>
      </div>
    {/each}
    {#each pendingOf('steps') as name (name)}
      <div class="group">{@render groupHead('steps', name, true)}</div>
    {/each}
    <label class="field">
      <span class="muted">Ajouter une étape (une ligne vide entre deux étapes)</span>
      <textarea rows="3" bind:value={newStep}></textarea>
    </label>
    <div class="add">
      <button type="button" class="btn small" onclick={addStep}><Icon name="plus" size={20} /> Ajouter</button>
      {@render addTarget('steps')}
    </div>
    {@render newGroupRow('steps')}
  </section>

  <section class="card">
    <label class="field">
      <span class="card-label">Nos astuces</span>
      <textarea rows="3" bind:value={content.tips} maxlength="4000" placeholder="Moins de sucre, cuisson un peu plus longue…"></textarea>
    </label>
  </section>

  <footer>
    {#if problem || error}<p class="error">{problem ?? error}</p>{/if}
    <button type="button" class="btn" onclick={onCancel}>Annuler</button>
    <button type="submit" class="btn primary" disabled={saving}><Icon name="check" size={22} /> {saving ? 'Enregistrement…' : 'Enregistrer'}</button>
  </footer>
</form>

<style>
  .editor {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-3);
    user-select: text;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .row > .field {
    flex: 1 1 160px;
  }

  input,
  select,
  textarea {
    min-height: 48px;
    padding: 8px 14px;
    border: 2px solid var(--surface-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, 1.1rem);
    box-sizing: border-box;
    width: 100%;
  }

  textarea {
    resize: vertical;
  }

  .title {
    font-size: var(--text-title);
    font-weight: 600;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .stepper input {
    width: 90px;
    text-align: center;
  }

  .stepper button,
  .icon {
    display: grid;
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
    cursor: pointer;
  }

  .icon:disabled {
    opacity: 0.35;
  }

  /* Le chevron « suivant » tourné vers le haut : monter d'un cran. */
  .icon.up :global(svg) {
    transform: rotate(-90deg);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .group + .group {
    margin-top: var(--space-1);
  }

  /* Titre d'un groupe, modifiable sur place : le nom écrit comme sur la fiche. */
  .group-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .group-head input {
    border-color: transparent;
    border-bottom-color: var(--border-strong);
    background: transparent;
    color: var(--rain-soft);
    font-weight: 700;
  }

  .loose {
    margin: 0;
  }

  .hint {
    margin: 0;
    font-size: 0.95rem;
  }

  .parsed {
    flex-wrap: wrap;
    align-items: center;
  }

  .parsed > span {
    flex: 1 1 140px;
  }

  .group-choice {
    width: auto;
    max-width: 60%;
    min-height: 40px;
    margin-left: auto;
    padding: 4px 10px;
    font-size: 0.95rem;
  }

  .add,
  .new-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .new-group input {
    flex: 1 1 200px;
    width: auto;
  }

  .target {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .target select {
    width: auto;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--fg-soft);
  }

  .check input {
    width: 24px;
    min-height: 24px;
  }

  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .number {
    display: grid;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    place-items: center;
    border-radius: 50%;
    background: var(--surface-2);
    font-weight: 700;
  }

  .parsed {
    display: flex;
    justify-content: space-between;
    gap: var(--space-1);
    padding: 4px 4px 0;
    color: var(--fg-muted);
    font-size: 0.95rem;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--rain-soft);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .adjust {
    display: grid;
    grid-template-columns: 1fr 1fr 2fr;
    gap: var(--space-1);
    margin-top: var(--space-1);
    color: var(--fg-soft);
    font-size: 0.95rem;
  }

  .adjust label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .muted {
    color: var(--fg-muted);
  }

  footer {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .error {
    margin: 0 auto 0 0;
    color: var(--danger-fg);
  }

  .phone {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .phone .card {
    padding: 16px;
    border-radius: 20px;
  }

  .phone .adjust {
    grid-template-columns: 1fr 1fr;
  }

  .phone .adjust label:last-child {
    grid-column: 1 / -1;
  }
</style>
