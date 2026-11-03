<script lang="ts">
  import { onDestroy } from 'svelte';
  import { renderSVG } from 'uqr';
  import type { Device, PairingCode } from '../../../shared/types.ts';
  import { getAppContext } from '../lib/context.ts';
  import { formatDay } from '../lib/format.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import type { Profile } from '../lib/profiles.ts';
  import { PAIR_PATH } from '../lib/route.ts';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import PinPad from './PinPad.svelte';

  // Téléphones de la famille (tablette seulement) : on choisit d'abord le profil, puis le téléphone scanne le code,
  // qui le lie à ce profil seul. Le code ne sert qu'une fois et expire au bout de 5 minutes. Un profil qui a un PIN
  // (scripts/set-pin.ts) le demande avant d'afficher son code.
  const DEVICES_REFRESH_MS = 15_000;
  const PAIRING_REFRESH_MS = 2_000;

  const { api, profiles, clock } = getAppContext();
  const members = profiles.filter((p) => !p.isFamily);
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;

  let pairing = $state<PairingCode | null>(null);
  let pairingError = $state<string | null>(null);
  /** Téléphone appairé pendant que le code était affiché. */
  let paired = $state<Device | null>(null);
  let confirmRemove = $state<string | null>(null);
  /** Profil dont on saisit le PIN. */
  let asking = $state<Profile | null>(null);
  let pinError = $state<string | null>(null);
  let known = new Set<string>();

  const devices = createResource(async () => {
    const list = await api.devices();
    const fresh = pairing ? list.find((d) => d.ownerId === pairing!.ownerId && !known.has(d.id)) : undefined;
    if (fresh) {
      paired = fresh;
      pairing = null;
    }
    known = new Set(list.map((d) => d.id));
    return list;
  }, DEVICES_REFRESH_MS);
  const pins = createResource(() => api.pairingPins(), 60_000);
  onDestroy(() => {
    devices.destroy();
    pins.destroy();
  });
  const hasPin = (id: string) => pins.data?.protected.includes(id) ?? false;

  // Pendant que le code est affiché, on guette le téléphone plus souvent.
  $effect(() => {
    if (!pairing) return;
    const timer = setInterval(devices.refresh, PAIRING_REFRESH_MS);
    return () => clearInterval(timer);
  });

  const remainingMs = $derived(pairing ? new Date(pairing.expiresAt).getTime() - clock.now.getTime() : 0);
  const expired = $derived(pairing !== null && remainingMs <= 0);
  const countdown = $derived.by(() => {
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });
  const qr = $derived(pairing ? renderSVG(`${location.origin}${PAIR_PATH}#${pairing.code}`, { pixelSize: 8 }) : '');

  function choose(profile: Profile) {
    pairingError = null;
    paired = null;
    if (hasPin(profile.id)) {
      pinError = null;
      asking = profile;
    } else {
      void start(profile.id);
    }
  }

  /** Vrai si le code est affiché ; sinon l'erreur est montrée (sous le PIN quand on le saisit). */
  async function start(ownerId: string, pin?: string): Promise<boolean> {
    try {
      known = new Set((devices.data ?? []).map((d) => d.id));
      pairing = await api.createPairing(ownerId, pin);
      asking = null;
      return true;
    } catch (err) {
      if (pin) pinError = (err as Error).message;
      else pairingError = (err as Error).message;
      return false;
    }
  }

  async function remove(device: Device) {
    if (confirmRemove !== device.id) {
      confirmRemove = device.id;
      return;
    }
    confirmRemove = null;
    try {
      await api.removeDevice(device.id);
    } finally {
      await devices.refresh();
    }
  }
</script>

<div class="phones">
  <section class="card pair">
    {#if asking}
      {@const profile = asking}
      <PinPad {profile} error={pinError} onSubmit={(pin) => start(profile.id, pin)} onCancel={() => (asking = null)} />
    {:else if pairing && !expired}
      <h2>Code pour {nameOf(pairing.ownerId)}</h2>
      <div class="qr">{@html qr}</div>
      <p class="muted">Ouvre l’appareil photo du téléphone et vise le code. Valable encore {countdown}, une seule fois.</p>
      <button type="button" class="secondary" onclick={() => (pairing = null)}>Annuler</button>
    {:else}
      <h2>Ajouter un téléphone</h2>
      {#if paired}
        <p class="success"><Icon name="check" size={28} color="var(--ok)" strokeWidth={2.4} /> {paired.name} est relié à {nameOf(paired.ownerId)}.</p>
      {:else if expired}
        <p class="muted">Le code a expiré. Choisis à nouveau le profil.</p>
      {:else}
        <p class="muted">À qui est ce téléphone ? Il n’agira qu’au nom de ce profil.</p>
      {/if}
      <div class="members">
        {#each members as profile (profile.id)}
          <button type="button" class="member" onclick={() => choose(profile)}>
            <Avatar {profile} size={64} />
            <span class="member-name">
              {#if hasPin(profile.id)}<Icon name="lock" size={18} color="var(--fg-muted)" />{/if}
              {profile.name}
            </span>
          </button>
        {/each}
      </div>
      {#if pairingError}<p class="error">{pairingError}</p>{/if}
      <p class="muted small">Le téléphone doit être sur le Wi-Fi de la maison (ou le VPN).</p>
    {/if}
  </section>

  <section class="card list">
    <h2>Téléphones reliés</h2>
    {#if devices.data}
      <ul>
        {#each devices.data as device (device.id)}
          {@const owner = profiles.find((p) => p.id === device.ownerId)}
          <li>
            {#if owner}<Avatar profile={owner} size={44} />{/if}
            <span class="device">
              <span class="name">{device.name}</span>
              <span class="muted small">
                {nameOf(device.ownerId)} · relié {formatDay(new Date(device.pairedAt), clock.now).toLowerCase()} · vu {formatDay(
                  new Date(device.lastSeenAt),
                  clock.now,
                ).toLowerCase()}
              </span>
            </span>
            <button type="button" class="remove" class:confirm={confirmRemove === device.id} onclick={() => remove(device)}>
              {confirmRemove === device.id ? 'Confirmer' : 'Retirer'}
            </button>
          </li>
        {:else}
          <li class="muted">Aucun téléphone pour l’instant.</li>
        {/each}
      </ul>
    {:else if devices.error}
      <p class="error">{devices.error}</p>
    {/if}
  </section>
</div>

<style>
  .phones {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    min-height: 0;
    flex: 1;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
    padding: 24px 28px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow-y: auto;
  }

  .pair {
    align-items: center;
    text-align: center;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  p {
    margin: 0;
  }

  .muted {
    font-size: 1.15rem;
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.95rem;
  }

  .qr {
    width: 300px;
    padding: 14px;
    border-radius: 20px;
    background: #fff;
    line-height: 0;
  }

  .qr :global(svg) {
    width: 100%;
    height: auto;
  }

  .members {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 16px;
    margin: 8px 0;
  }

  .member {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    min-width: 110px;
    padding: 16px 12px;
    border: 0;
    border-radius: 20px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1.15rem;
    font-weight: 600;
  }

  .member-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .member:active {
    background: var(--border-strong);
  }

  .success {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 1.2rem;
    color: var(--ok-fg);
  }

  .secondary {
    min-height: 52px;
    padding: 0 28px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 600;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 72px;
    border-bottom: 1px solid var(--surface-2);
  }

  li:last-child {
    border-bottom: 0;
  }

  .device {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    font-size: 1.2rem;
    font-weight: 600;
  }

  .remove {
    min-height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
  }

  .remove.confirm {
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  .error {
    color: var(--danger-fg);
  }
</style>
