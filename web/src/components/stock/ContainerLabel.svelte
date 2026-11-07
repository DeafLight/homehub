<script lang="ts">
  import { ean13Modules } from '../../../../shared/barcode.ts';

  // Étiquette d'un contenant de la maison : son nom et son code-barres (EAN-13 à usage interne), à imprimer et coller.
  type Props = { name: string; code: string };
  let { name, code }: Props = $props();

  const MODULE = 3;
  const QUIET = 11;
  const HEIGHT = 120;
  const bars = $derived.by(() => {
    const modules = ean13Modules(code);
    const result: { x: number; width: number; guard: boolean }[] = [];
    for (let i = 0; i < modules.length; i++) {
      if (modules[i] !== '1') continue;
      const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
      const last = result.at(-1);
      // Barres voisines de même hauteur fusionnées : un seul rectangle.
      if (last && last.x + last.width === (QUIET + i) * MODULE && last.guard === guard) last.width += MODULE;
      else result.push({ x: (QUIET + i) * MODULE, width: MODULE, guard });
    }
    return result;
  });
  const width = (95 + 2 * QUIET) * MODULE;
</script>

<figure class="label">
  <figcaption>{name}</figcaption>
  <svg viewBox="0 0 {width} {HEIGHT + 34}" role="img" aria-label="Code-barres {code}">
    <rect width={width} height={HEIGHT + 34} fill="#fff" />
    {#each bars as bar (bar.x)}
      <rect x={bar.x} y="6" width={bar.width} height={bar.guard ? HEIGHT + 8 : HEIGHT} fill="#000" />
    {/each}
    <text x={width / 2} y={HEIGHT + 30} text-anchor="middle" font-size="22" font-family="monospace" fill="#000">{code}</text>
  </svg>
</figure>

<style>
  .label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 16px;
    border-radius: var(--radius-md);
    background: #fff;
    color: #000;
  }

  figcaption {
    font-size: 1.4rem;
    font-weight: 700;
  }

  svg {
    width: 100%;
    max-width: 360px;
  }
</style>
