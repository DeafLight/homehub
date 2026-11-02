<script lang="ts">
  import Icon from './Icon.svelte';

  // Bandeau discret affiché quand le serveur ne répond plus ; les données affichées sont alors les dernières reçues.
  type Props = { message: string };
  let { message }: Props = $props();
</script>

<div class="status" role="status">
  <Icon name="offline" size={20} />
  {message}
</div>

<style>
  .status {
    position: fixed;
    right: 16px;
    bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--danger-bg);
    color: var(--danger-fg);
    font-size: 1rem;
  }
</style>
