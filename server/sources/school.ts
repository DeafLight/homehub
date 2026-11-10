// Mise en forme commune aux deux sources scolaires (ÉcoleDirecte, Pronote) : noms de matières et prénoms comparés
// sans accents ni majuscules. Ni l'une ni l'autre ne dépend ainsi de l'autre.

/** « SCIENCES VIE & TERRE » → « Sciences vie & terre » ; les sigles avec chiffres restent (« Anglais LV1 »). */
export function formatSubject(value: string): string {
  const words = value.trim().toLowerCase().split(/\s+/);
  return words
    .map((w, i) => (/\d/.test(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Prénom comparable : sans accents, sans espaces autour, en minuscules (« Léa » = « LEA »). */
export const normalizeName = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
