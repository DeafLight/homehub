<script lang="ts">
  import { onDestroy } from 'svelte';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { formatTime } from '../lib/format.ts';
  import { type NasLevel, nasBanner, nasRings, nasServices, nasTimeline, nasWatch } from '../lib/nas.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import type { PageRoute } from '../lib/route.ts';

  /** Le relevé change toutes les 5 minutes. */
  const NAS_REFRESH_MS = 60_000;
  const RING_RADIUS = 50;
  const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

  // Page du NAS qui héberge HomeHub, ouverte en touchant la version sur l'accueil : son état en un coup d'œil,
  // ce qui mérite attention, ses services et ce qui s'est passé dernièrement.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, clock } = getAppContext();
  const nas = createResource(() => api.nas(), NAS_REFRESH_MS);
  onDestroy(nas.destroy);

  const levelColor = (level: NasLevel) => `var(--${level})`;
</script>

<div class="nas-page">
  <header>
    <BackButton {back} />
    <h1>Le NAS</h1>
    {#if nas.data}
      {@const { status, homehub } = nas.data}
      <span class="muted updated">
        {[
          `HomeHub v${homehub.version}`,
          status?.version && `TrueNAS ${status.version}`,
          status && `relevé à ${formatTime(new Date(status.generatedAt))}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    {/if}
  </header>

  {#if nas.data}
    {@const data = nas.data}
    {@const banner = nasBanner(data, clock.now)}
    {@const watch = nasWatch(data, clock.now)}
    {@const timeline = nasTimeline(data, clock.now)}
    <div class="layout">
      <div class="column">
        <section class="banner {banner.level}">
          <Icon name={banner.level === 'ok' ? 'check' : 'alert'} size={64} color={levelColor(banner.level)} strokeWidth={1.8} />
          <span class="banner-text">
            <span class="banner-title">{banner.title}</span>
            <span class="banner-detail">{banner.detail}</span>
          </span>
        </section>

        <section class="card watch">
          <h2>À surveiller</h2>
          {#each watch as item (item.title)}
            <div class="watch-item">
              <span class="dot top" style:background={levelColor(item.level)}></span>
              <span class="watch-text">
                <span class="watch-title">{item.title}</span>
                <span class="muted small">{item.text}</span>
              </span>
            </div>
          {:else}
            <p class="muted">Rien à signaler.</p>
          {/each}
        </section>
      </div>

      <div class="column">
        {#if data.status}
          <section class="rings">
            {#each nasRings(data.status) as ring (ring.label)}
              <div class="ring-card">
                <span class="ring">
                  <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
                    <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="var(--surface-2)" stroke-width="12" />
                    <circle
                      cx="60"
                      cy="60"
                      r={RING_RADIUS}
                      fill="none"
                      stroke={levelColor(ring.level)}
                      stroke-width="12"
                      stroke-linecap="round"
                      stroke-dasharray="{(Math.min(100, Math.max(0, ring.percent)) / 100) * RING_LENGTH} {RING_LENGTH}"
                      transform="rotate(-90 60 60)"
                    />
                  </svg>
                  <span class="ring-value">{ring.value}</span>
                </span>
                <span class="ring-label">{ring.label}</span>
                <span class="muted small">{ring.detail}</span>
              </div>
            {/each}
          </section>
        {/if}

        <div class="lists">
          <section class="card">
            <h2>Services</h2>
            {#if data.status}
              {@const services = nasServices(data.status)}
              {#if services}
                {#each services as service (service.label)}
                  <div class="row">
                    <span class="dot" style:background={levelColor(service.level)}></span>
                    <span class="row-label">{service.label}</span>
                    <span class="muted small">{service.info}</span>
                  </div>
                {/each}
              {:else}
                <p class="muted">État des services inconnu.</p>
              {/if}
            {:else}
              <p class="muted">Pas de relevé du NAS.</p>
            {/if}
          </section>

          <section class="card">
            <h2>Dernièrement</h2>
            {#each timeline as event (event.text)}
              <div class="event">
                <span class="muted small">{event.when}</span>
                <span class="event-text">
                  {#if event.level === 'bad'}<span class="dot inline" style:background={levelColor(event.level)}></span>{/if}
                  {event.text}
                </span>
              </div>
            {/each}
          </section>
        </div>
      </div>
    </div>
  {:else if nas.error}
    <p class="muted">Impossible de charger l’état du NAS : {nas.error}</p>
  {/if}
</div>

<style>
  .nas-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 28px 40px 36px;
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
    margin: 0 0 4px;
    font-size: 1.4rem;
    font-weight: 600;
  }

  p {
    margin: 0;
  }

  .updated {
    margin-left: auto;
  }

  .muted {
    font-size: 1.2rem;
    color: var(--fg-muted);
  }

  .small {
    font-size: 1rem;
  }

  .layout {
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 420px minmax(0, 1fr);
    gap: 20px;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 0;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 20px 24px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    min-height: 0;
    overflow: hidden;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 24px 28px;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .banner.ok {
    background: var(--ok-bg);
  }

  .banner.warn {
    background: var(--warn-bg);
  }

  .banner.bad {
    background: var(--danger-bg);
  }

  .banner-text,
  .watch-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .banner-title {
    font-size: 2rem;
    font-weight: 700;
  }

  .banner-detail {
    font-size: 1.15rem;
    color: var(--fg-soft);
  }

  .banner.ok .banner-detail {
    color: var(--ok-fg);
  }

  .watch {
    flex-grow: 1;
  }

  .watch-item {
    display: flex;
    gap: 14px;
    padding: 12px 0;
    border-top: 1px solid var(--surface-2);
  }

  .watch-title {
    font-size: 1.15rem;
    font-weight: 600;
  }

  .dot {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    border-radius: 50%;
  }

  .dot.top {
    margin-top: 6px;
  }

  .dot.inline {
    display: inline-block;
    margin-right: 6px;
  }

  .rings {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: 16px;
  }

  .ring-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 14px 12px;
    border-radius: var(--radius-md);
    background: var(--surface);
    text-align: center;
  }

  .ring {
    position: relative;
    width: 120px;
    height: 120px;
  }

  .ring-value {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.6rem;
    font-weight: 700;
  }

  .ring-label {
    font-size: 1.15rem;
    font-weight: 600;
  }

  .lists {
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 20px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 31px;
    font-size: 1.05rem;
    white-space: nowrap;
  }

  .row-label {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event {
    display: grid;
    grid-template-columns: 100px minmax(0, 1fr);
    gap: 10px;
    padding: 9px 0;
    border-top: 1px solid var(--surface-2);
  }

  .event-text {
    font-size: 1.05rem;
  }
</style>
