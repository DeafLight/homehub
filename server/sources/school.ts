// Mise en forme commune aux deux sources scolaires (ÉcoleDirecte, Pronote) : noms de matières (casse, accents remis)
// et prénoms comparés sans accents ni majuscules. Ni l'une ni l'autre ne dépend ainsi de l'autre.

/**
 * Mots des matières qu'ÉcoleDirecte donne en capitales sans accents (« MATHEMATIQUES », « EDUCATION MUSICALE ») :
 * forme accentuée de chaque mot, en minuscules. Un mot déjà accenté (Pronote) ou absent de la table reste tel quel.
 */
const ACCENTED: Record<string, string> = {
  antiquite: 'antiquité',
  cinema: 'cinéma',
  eco: 'éco',
  economie: 'économie',
  economiques: 'économiques',
  education: 'éducation',
  electricite: 'électricité',
  etranger: 'étranger',
  etrangere: 'étrangère',
  etrangeres: 'étrangères',
  etude: 'étude',
  etudes: 'études',
  europeenne: 'européenne',
  francais: 'français',
  general: 'général',
  generale: 'générale',
  geo: 'géo',
  geographie: 'géographie',
  geologie: 'géologie',
  geopolitique: 'géopolitique',
  litterature: 'littérature',
  litteratures: 'littératures',
  mathematiques: 'mathématiques',
  medias: 'médias',
  methodologie: 'méthodologie',
  numerique: 'numérique',
  personnalise: 'personnalisé',
  regionale: 'régionale',
  remediation: 'remédiation',
  sante: 'santé',
  societe: 'société',
  specialite: 'spécialité',
  theatre: 'théâtre',
};

/** Sigles de matières, gardés en capitales (« EPS », « SVT ») ; un sigle avec chiffre l'est toujours (« LV1 »). */
const ACRONYMS = new Set(['ap', 'eps', 'emc', 'hggsp', 'llce', 'llcer', 'nsi', 'ses', 'si', 'snt', 'stmg', 'svt']);

const formatWord = (word: string) =>
  word
    .split('-')
    .map((part) => (/\d/.test(part) || ACRONYMS.has(part) ? part.toUpperCase() : (ACCENTED[part] ?? part)))
    .join('-');

/**
 * « SCIENCES VIE & TERRE » → « Sciences vie & terre », « MATHEMATIQUES » → « Mathématiques » ; les sigles restent
 * (« Anglais LV1 », « EPS »).
 */
export function formatSubject(value: string): string {
  const words = value.trim().toLowerCase().split(/\s+/).map(formatWord);
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

/** Prénom comparable : sans accents, sans espaces autour, en minuscules (« Léa » = « LEA »). */
export const normalizeName = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/** « 20 », « 20,00 », « 7.5 » → nombre ; null si ce n'en est pas un. */
export function parseFrenchNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = value?.trim().replace(',', '.');
  if (!text || !/^-?\d+(\.\d+)?$/u.test(text)) return null;
  return Number(text);
}

/** 15.5 → « 15,5 » ; 12 → « 12 » (deux décimales au plus, sans zéros inutiles). */
export const formatFrenchNumber = (value: number) => String(Math.round(value * 100) / 100).replace('.', ',');

/** Durée en minutes, comme on la dit : « 10 min », « 2 h », « 1 h 30 ». */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** Année scolaire de cette date, « 2026-2027 » (elle commence en août, avant la rentrée). */
export function schoolYear(date: Date): string {
  const start = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${start + 1}`;
}
