<script lang="ts">
  type Health = { status: string; version: string; time: string };

  let health = $state<Health | null>(null);
  let error = $state(false);

  async function refresh() {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      health = await res.json();
      error = false;
    } catch {
      error = true;
    }
  }

  $effect(() => {
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  });

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

<main>
  <h1>Hello HomeHub</h1>
  {#if health}
    <p class="time">{formatTime(health.time)}</p>
  {/if}
  <p class="status" class:error>
    {#if error}
      Serveur injoignable
    {:else if health}
      Serveur OK · v{health.version}
    {:else}
      Connexion…
    {/if}
  </p>
</main>

<style>
  main {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }

  h1 {
    margin: 0;
    font-size: clamp(2rem, 6vw, 4rem);
    font-weight: 600;
  }

  .time {
    margin: 0;
    font-size: clamp(3rem, 14vw, 9rem);
    font-variant-numeric: tabular-nums;
  }

  .status {
    margin: 0;
    font-size: 1.25rem;
    color: var(--ok);
  }

  .status.error {
    color: var(--error);
  }
</style>
