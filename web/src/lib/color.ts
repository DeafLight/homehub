// Calculs de couleur sur des #rrggbb (sans color-mix(), absent des WebView Android anciennes).

const toRgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Mélange `color` dans `base` : ratio 0 = base, 1 = color. */
export function mix(color: string, base: string, ratio: number): string {
  const a = toRgb(color);
  const b = toRgb(base);
  return toHex(a.map((v, i) => b[i] + (v - b[i]) * ratio));
}

/** Luminance relative WCAG. */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Texte foncé ou clair, celui qui contraste le plus avec `background`. */
export function textColorOn(background: string, dark = '#0f1115', light = '#ffffff'): string {
  const l = luminance(background);
  const contrastDark = (l + 0.05) / (luminance(dark) + 0.05);
  const contrastLight = (luminance(light) + 0.05) / (l + 0.05);
  return contrastDark >= contrastLight ? dark : light;
}

/**
 * Copies en #rrggbb de jetons de app.css, pour les mélanges calculés ici (mix() ne lit pas les variables CSS) :
 * à changer avec eux.
 */
export const TOKENS = { bg: '#0f1115', surface: '#181b22', fgMuted: '#9aa1ab', white: '#ffffff' } as const;
