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
