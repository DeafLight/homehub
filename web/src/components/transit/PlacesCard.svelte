<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AddressMatch, PlaceIcon, StopChoice, TransitPlace, TransitSettings } from '../../../../shared/types.ts';
  import { type Api, ApiError } from '../../lib/api.ts';
  import { createDebouncer } from '../../lib/debounce.ts';
  import { MAX_PLACES, nearKey, nextIcon, placeAddress, placeInUse } from '../../lib/transit-edit.ts';
  import Icon, { type IconName } from '../Icon.svelte';

  // Carte « Lieux » de la page Transports : chaque lieu de la famille (nom, icône, adresse cherchée sur la
  // Géoplateforme) et le nombre d'arrêts proches. Modifie le brouillon de la page ; rien n'est enregistré ici.
  type Props = {
    draft: TransitSettings;
    api: Api;
    /** Arrêts proches de chaque lieu, par coordonnées (`nearKey`). */
    near: Record<string, StopChoice[]>;
    onEdit: () => void;
    /** Un lieu a une nouvelle adresse : ses arrêts proches sont à chercher. */
    onAddress: () => void;
    onMessage: (text: string) => void;
  };
  let { draft = $bindable(), api, near, onEdit, onAddress, onMessage }: Props = $props();

  const ICONS: Record<PlaceIcon, IconName> = { home: 'home', school: 'school', sport: 'flag', place: 'pin' };
  const SEARCH_DELAY_MS = 400;
  const debouncer = createDebouncer(SEARCH_DELAY_MS);
  onDestroy(debouncer.cancel);

  /** Champ de recherche ouvert d'un toucher : prêt à taper. */
  const focus = (node: HTMLInputElement) => node.focus();

  /** Lieu dont on cherche l'adresse : un nouveau (`new`) ou un existant (son identifiant). */
  let addressFor = $state<string | null>(null);
  let addressQuery = $state('');
  let addresses = $state<AddressMatch[]>([]);
  let addressError = $state<string | null>(null);
  const searchAddresses = debouncer.wrap(async () => {
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
    addressQuery = target === 'new' ? '' : (draft.places.find((p) => p.id === target)?.address ?? '');
    addresses = [];
    addressError = null;
  }

  function pickAddress(match: AddressMatch) {
    if (!addressFor) return;
    placeAddress(draft, addressFor, match);
    addressFor = null;
    onEdit();
    onAddress();
  }

  function removePlace(place: TransitPlace) {
    if (placeInUse(draft, place.id)) return onMessage(`« ${place.label} » sert à un trajet : change d’abord le trajet`);
    draft.places = draft.places.filter((p) => p.id !== place.id);
    onEdit();
  }

  const nearOf = (place: TransitPlace) => near[nearKey(place)];
</script>

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

<section class="card">
  <h2><Icon name="pin" size={28} /> Lieux</h2>
  {#each draft.places as place (place.id)}
    <div class="row">
      <button type="button" class="icon" aria-label="Changer l'icône de « {place.label} »" onclick={() => ((place.icon = nextIcon(place.icon)), onEdit())}>
        <Icon name={ICONS[place.icon]} size={26} />
      </button>
      <span class="place">
        <input class="label" type="text" maxlength="30" aria-label="Nom du lieu" bind:value={place.label} oninput={onEdit} />
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

<style>
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
</style>
