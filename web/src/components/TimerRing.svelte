<script lang="ts">
  // Petit anneau d'un minuteur en cours, qui se vide à mesure que le temps passe (de la couleur de son activité).
  type Props = { progress: number; color: string; size?: number };
  let { progress, color, size = 28 }: Props = $props();

  const R = 10;
  const LENGTH = 2 * Math.PI * R;
</script>

<svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
  <circle cx="13" cy="13" r={R} fill="none" stroke="var(--border-strong)" stroke-width="4" />
  <circle
    cx="13"
    cy="13"
    r={R}
    fill="none"
    stroke={color}
    stroke-width="4"
    stroke-linecap="round"
    stroke-dasharray="{LENGTH * progress} {LENGTH}"
    transform="rotate(-90 13 13)"
  />
</svg>
