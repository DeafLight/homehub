<script lang="ts" module>
  // Muscles du catalogue → zones de la silhouette (face, dos). « Cœur et souffle » n'est pas une zone.
  const ZONES: Record<string, string[]> = {
    Pectoraux: ['pecs'],
    'Haut des pectoraux': ['pecs'],
    Épaules: ['delts', 'rdelts'],
    'Avant des épaules': ['delts'],
    'Arrière des épaules': ['rdelts'],
    Biceps: ['biceps'],
    Triceps: ['triceps'],
    Abdominaux: ['abs'],
    Transverse: ['abs'],
    Obliques: ['obliques'],
    Quadriceps: ['quads'],
    Adducteurs: ['adductors'],
    'Fléchisseurs de hanche': ['hipflex'],
    Trapèzes: ['traps'],
    'Haut du dos': ['upperback', 'traps'],
    Rhomboïdes: ['upperback'],
    'Grand dorsal': ['lats'],
    Lombaires: ['lowerback'],
    Fessiers: ['glutes'],
    'Ischio-jambiers': ['hams'],
    Mollets: ['calves'],
  };

  export const zonesOf = (muscles: string[]) => new Set(muscles.flatMap((m) => ZONES[m] ?? []));
</script>

<script lang="ts">
  // Silhouette face et dos : muscles principaux en plein, les autres en clair.
  type Props = { primary: string[]; secondary: string[] };
  let { primary, secondary }: Props = $props();

  const main = $derived(zonesOf(primary));
  const also = $derived(zonesOf(secondary));
  const cls = (zone: string) => (main.has(zone) ? 'zone main' : also.has(zone) ? 'zone also' : 'zone');
  const cardio = $derived([...primary, ...secondary].includes('Cœur et souffle'));
</script>

<div class="map">
  <figure>
    <svg viewBox="20 0 60 122" role="img" aria-label="Muscles, de face">
      <circle cx="50" cy="9" r="7" class="body" />
      <rect x="46" y="15" width="8" height="6" class="body" />
      <ellipse cx="27.5" cy="66" rx="3" ry="3.5" class="body" />
      <ellipse cx="72.5" cy="66" rx="3" ry="3.5" class="body" />
      <ellipse cx="43" cy="103" rx="3.6" ry="10" class="body" />
      <ellipse cx="57" cy="103" rx="3.6" ry="10" class="body" />
      <ellipse cx="42" cy="116" rx="4.5" ry="2.2" class="body" />
      <ellipse cx="58" cy="116" rx="4.5" ry="2.2" class="body" />
      <ellipse cx="34" cy="26" rx="5.5" ry="5" class={cls('delts')} />
      <ellipse cx="66" cy="26" rx="5.5" ry="5" class={cls('delts')} />
      <path d="M49.5 23 L39 24.5 Q36.5 33 41.5 36.5 L49.5 36 Z" class={cls('pecs')} />
      <path d="M50.5 23 L61 24.5 Q63.5 33 58.5 36.5 L50.5 36 Z" class={cls('pecs')} />
      <ellipse cx="31" cy="39" rx="3.6" ry="7.5" class={cls('biceps')} transform="rotate(10 31 39)" />
      <ellipse cx="69" cy="39" rx="3.6" ry="7.5" class={cls('biceps')} transform="rotate(-10 69 39)" />
      <ellipse cx="28.5" cy="54" rx="3" ry="8.5" class="body" transform="rotate(6 28.5 54)" />
      <ellipse cx="71.5" cy="54" rx="3" ry="8.5" class="body" transform="rotate(-6 71.5 54)" />
      <path d="M43 38 L39 38.5 Q37.5 50 40 59.5 L43 59.5 Z" class={cls('obliques')} />
      <path d="M57 38 L61 38.5 Q62.5 50 60 59.5 L57 59.5 Z" class={cls('obliques')} />
      <rect x="44" y="37.5" width="12" height="22.5" rx="3" class={cls('abs')} />
      <ellipse cx="43" cy="80" rx="6" ry="13" class={cls('quads')} />
      <ellipse cx="57" cy="80" rx="6" ry="13" class={cls('quads')} />
      <ellipse cx="48" cy="75" rx="1.8" ry="8" class={cls('adductors')} />
      <ellipse cx="52" cy="75" rx="1.8" ry="8" class={cls('adductors')} />
      <ellipse cx="42.5" cy="64.5" rx="4.5" ry="2.8" class={cls('hipflex')} />
      <ellipse cx="57.5" cy="64.5" rx="4.5" ry="2.8" class={cls('hipflex')} />
    </svg>
    <figcaption>Face</figcaption>
  </figure>
  <figure>
    <svg viewBox="20 0 60 122" role="img" aria-label="Muscles, de dos">
      <circle cx="50" cy="9" r="7" class="body" />
      <rect x="46" y="15" width="8" height="6" class="body" />
      <ellipse cx="27.5" cy="66" rx="3" ry="3.5" class="body" />
      <ellipse cx="72.5" cy="66" rx="3" ry="3.5" class="body" />
      <ellipse cx="42" cy="116" rx="4.5" ry="2.2" class="body" />
      <ellipse cx="58" cy="116" rx="4.5" ry="2.2" class="body" />
      <ellipse cx="34" cy="26" rx="5.5" ry="5" class={cls('rdelts')} />
      <ellipse cx="66" cy="26" rx="5.5" ry="5" class={cls('rdelts')} />
      <path d="M42 31 L37.5 31 Q37 44 44 53 L46 40 Z" class={cls('lats')} />
      <path d="M58 31 L62.5 31 Q63 44 56 53 L54 40 Z" class={cls('lats')} />
      <rect x="42.5" y="27" width="15" height="12" rx="2.5" class={cls('upperback')} />
      <path d="M50 17 L39.5 24 L50 29.5 L60.5 24 Z" class={cls('traps')} />
      <rect x="45" y="41" width="10" height="18" rx="2.5" class={cls('lowerback')} />
      <ellipse cx="31" cy="39" rx="3.6" ry="7.5" class={cls('triceps')} transform="rotate(10 31 39)" />
      <ellipse cx="69" cy="39" rx="3.6" ry="7.5" class={cls('triceps')} transform="rotate(-10 69 39)" />
      <ellipse cx="28.5" cy="54" rx="3" ry="8.5" class="body" transform="rotate(6 28.5 54)" />
      <ellipse cx="71.5" cy="54" rx="3" ry="8.5" class="body" transform="rotate(-6 71.5 54)" />
      <ellipse cx="44" cy="66" rx="6" ry="6.5" class={cls('glutes')} />
      <ellipse cx="56" cy="66" rx="6" ry="6.5" class={cls('glutes')} />
      <ellipse cx="43" cy="84" rx="5.5" ry="11" class={cls('hams')} />
      <ellipse cx="57" cy="84" rx="5.5" ry="11" class={cls('hams')} />
      <ellipse cx="43" cy="103" rx="4" ry="9.5" class={cls('calves')} />
      <ellipse cx="57" cy="103" rx="4" ry="9.5" class={cls('calves')} />
    </svg>
    <figcaption>Dos</figcaption>
  </figure>
  {#if cardio}<p class="cardio">♥ Cœur et souffle : l’exercice fait aussi monter le rythme cardiaque.</p>{/if}
</div>

<style>
  .map {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 24px;
  }

  figure {
    margin: 0;
    text-align: center;
  }

  svg {
    display: block;
    height: 190px;
  }

  figcaption {
    color: var(--fg-muted);
    font-size: 0.85rem;
  }

  .body,
  .zone {
    fill: var(--surface-2);
    stroke: var(--bg);
    stroke-width: 0.6;
  }

  .zone.also {
    fill: var(--rain-soft);
    opacity: 0.55;
  }

  .zone.main {
    fill: var(--rain);
  }

  .cardio {
    flex-basis: 100%;
    margin: 4px 0 0;
    color: var(--fg-muted);
    font-size: 0.9rem;
    text-align: center;
  }
</style>
