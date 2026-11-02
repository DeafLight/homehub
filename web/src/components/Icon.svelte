<script lang="ts" module>
  // Icônes au trait (24×24), décoratives : le texte ou l'aria-label du parent porte le sens.
  const PATHS = {
    home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M10 21v-6h4v6'],
    chevron: ['m9 6 6 6-6 6'],
    clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
    sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
    family: ['M7 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M2 20c0-3 2.2-5 5-5s5 2 5 5M12 20c0-3 2.2-5 5-5s5 2 5 5'],
    offline: ['M2 8.8a15 15 0 0 1 20 0', 'M5 12.5a10 10 0 0 1 14 0', 'M8.5 16a5 5 0 0 1 7 0', 'M12 20h.01', 'M3 3l18 18'],
  } as const;

  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  type Props = { name: IconName; size?: number; color?: string; strokeWidth?: number };
  let { name, size = 24, color = 'currentColor', strokeWidth = 1.8 }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each PATHS[name] as d (d)}
    <path {d} />
  {/each}
</svg>
