// Monde fictif des captures de la doc : horloge arrêtée un jeudi matin, faux ÉcoleDirecte (emploi du temps, devoirs,
// notes, absences et retards, messagerie du compte Famille), faux temps réel Irigo,
// fausses bases de produits (Open Food Facts et ses sœurs), calendrier scolaire d'exemple, faux site de
// recettes (fake-recipes.ts).
// Aucune connexion réelle à l'école ni à Irigo ; la météo (Open-Meteo) et les horaires GTFS restent les vrais.
import { readFileSync } from 'node:fs';
import { fakeRecipeSite, RECIPE_HOST } from './fake-recipes.ts';

/** Jeudi 5 novembre 2026, 07:35 (heure locale) : cours du jour, routine du matin, bandeau du bus. */
export const DOCS_NOW = new Date(2026, 10, 5, 7, 35, 0).getTime();
/** Lundi 7 décembre 2026, 07:35 : « Vacances de Noël dans 12 jours ». */
export const DOCS_BEFORE_HOLIDAYS = new Date(2026, 11, 7, 7, 35, 0).getTime();
/** Lundi 21 décembre 2026, 10:00 : vacances de Noël, reprise lundi 4 janvier. */
export const DOCS_HOLIDAYS = new Date(2026, 11, 21, 10, 0, 0).getTime();
/** Mercredi 11 novembre 2026, 07:35 : jour férié, ni bus ni cours, routine du week-end. */
export const DOCS_PUBLIC_HOLIDAY = new Date(2026, 10, 11, 7, 35, 0).getTime();

/** Décale l'horloge du processus : `new Date()` et `Date.now()` partent de DOCS_NOW, puis avancent normalement. */
export function installFakeClock(target = DOCS_NOW): void {
  const RealDate = Date;
  const offset = target - RealDate.now();
  class FakeDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [number]));
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = FakeDate as DateConstructor;
}

const pad = (n: number) => String(n).padStart(2, '0');
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Devoirs d'exemple, par jour (relatif à aujourd'hui), au format du cahier de texte ÉcoleDirecte. */
const homework = (): Record<string, unknown[]> => ({
  [day(1)]: [
    { id: 1, matiere: 'MATHEMATIQUES', interrogation: true, aFaire: { idDevoir: 101, contenu: b64('<p>Réviser le chapitre 4 : fractions.</p><p>Exercices 12, 13 et 14 page 58.</p>'), effectue: false } },
    { id: 2, matiere: 'FRANCAIS', aFaire: { idDevoir: 102, contenu: b64('<p>Lire le chapitre 3 de <i>Vendredi ou la vie sauvage</i></p>'), effectue: true, documents: [{ id: 1 }] } },
    { id: 3, matiere: 'ANGLAIS LV1', aFaire: { idDevoir: 103, contenu: b64('Learn the irregular verbs list (1 to 20)'), effectue: false } },
  ],
  [day(4)]: [{ id: 4, matiere: 'HISTOIRE-GEOGRAPHIE', aFaire: { idDevoir: 104, contenu: b64('<ul><li>Apprendre la leçon sur Charlemagne</li><li>Compléter la carte</li></ul>'), effectue: false } }],
  [day(5)]: [{ id: 5, matiere: 'SCIENCES VIE & TERRE', interrogation: true, aFaire: { idDevoir: 105, contenu: b64('Contrôle sur la digestion'), effectue: false } }],
});

/** Notes de Léa, au format du carnet de notes ÉcoleDirecte (matières en capitales sans accents, comme le vrai). */
const grades = () => [
  { id: 201, devoir: 'Contrôle fractions', libelleMatiere: 'MATHEMATIQUES', date: day(-2), valeur: '15,5', noteSur: '20', coef: '2', moyenneClasse: '12,4' },
  { id: 202, devoir: 'Dictée', libelleMatiere: 'FRANCAIS', date: day(-6), valeur: '8', noteSur: '10', coef: '1', moyenneClasse: '6,5' },
  { id: 203, devoir: 'Irregular verbs', libelleMatiere: 'ANGLAIS LV1', date: day(-9), valeur: '17', noteSur: '20', coef: '1' },
  { id: 204, devoir: 'La digestion', libelleMatiere: 'SCIENCES VIE & TERRE', date: day(-13), valeur: 'Abs', noteSur: '20', coef: '1' },
  { id: 205, devoir: 'Charlemagne', libelleMatiere: 'HISTOIRE-GEOGRAPHIE', date: day(-20), valeur: '13', noteSur: '20', coef: '1', moyenneClasse: '11,8' },
];

/** Absences et retards de Léa, au format de la vie scolaire ÉcoleDirecte. */
const attendance = () => [
  { id: 301, typeElement: 'Retard', date: day(-3), libelle: '10 minutes', motif: '', justifie: false },
  { id: 302, typeElement: 'Absence', date: day(-13), libelle: '1 demi-journée', motif: 'Rendez-vous médical', justifie: true },
];

/** Messages reçus par le compte Famille (la liste seulement, comme HomeHub la lit). */
const messages = () => {
  const at = (offset: number, time: string) => `${day(offset)} ${time}`;
  return [
    { id: 401, subject: 'Réunion parents-professeurs du 19 novembre', date: at(-1, '17:42:10'), read: false, from: { civilite: 'M.', prenom: 'Paul', nom: 'Martin' } },
    { id: 402, subject: 'Sortie au musée des Beaux-Arts', date: at(-4, '12:05:00'), read: false, from: { civilite: 'Mme', prenom: 'Claire', nom: 'Durand' } },
    { id: 403, subject: 'Photos de classe', date: at(-12, '09:30:00'), read: true, from: { name: 'Vie scolaire' } },
  ];
};

function fakeEcoleDirecte(url: URL): Response {
  const path = url.pathname.replace('/v3/', '');
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'x-token': 'docs' } });
  if (url.searchParams.has('gtk')) return new Response('', { headers: { 'Set-Cookie': 'GTK=docs; Path=/' } });
  if (path === 'login.awp') {
    return json({ code: 200, data: { accounts: [{ main: true, typeCompte: '1', id: 1, prenom: 'Parent', profile: { eleves: [{ id: 7, prenom: 'Léa' }] } }] } });
  }
  if (path === 'E/7/emploidutemps.awp') {
    const courses = [];
    for (let i = -3; i < 21; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const k = day(i);
      courses.push(
        { id: `${k}-1`, matiere: 'MATHEMATIQUES', start_date: `${k} 08:30`, end_date: `${k} 09:25`, salle: 'B12' },
        { id: `${k}-2`, matiere: 'FRANCAIS', start_date: `${k} 09:30`, end_date: `${k} 10:25`, salle: 'A03' },
        { id: `${k}-3`, matiere: 'ANGLAIS LV1', start_date: `${k} 13:30`, end_date: `${k} 14:25`, salle: 'C01' },
        { id: `${k}-4`, matiere: 'SCIENCES VIE & TERRE', start_date: `${k} 14:30`, end_date: `${k} 16:25`, salle: 'Labo' },
      );
    }
    return json({ code: 200, data: courses });
  }
  if (path === 'eleves/7/notes.awp') return json({ code: 200, data: { notes: grades() } });
  if (path === 'eleves/7/viescolaire.awp') return json({ code: 200, data: { absencesRetards: attendance(), sanctionsEncouragements: [] } });
  if (path === 'familles/1/messages.awp') return json({ code: 200, data: { classeurs: [], messages: { received: messages(), sent: [] } } });
  const detail = homework();
  if (path === 'Eleves/7/cahierdetexte.awp') {
    return json({ code: 200, data: Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, v.map(() => ({ aFaire: true }))])) });
  }
  const m = /^Eleves\/7\/cahierdetexte\/(.+)\.awp$/u.exec(path);
  if (m) return json({ code: 200, data: { date: m[1], matieres: detail[m[1]] ?? [] } });
  return json({ code: 404, message: path });
}

function fakeSiri(): Response {
  const visit = (line: string, dest: string, minutes: number, live = true) => {
    const t = new Date(Date.now() + minutes * 60_000).toISOString();
    const expected = live ? `<siri:ExpectedDepartureTime>${t}</siri:ExpectedDepartureTime>` : '';
    return `<siri:MonitoredStopVisit><siri:MonitoredVehicleJourney><siri:LineRef>${line}</siri:LineRef><siri:DestinationName>${dest}</siri:DestinationName><siri:MonitoredCall><siri:StopPointName>Ralliement</siri:StopPointName><siri:AimedDepartureTime>${t}</siri:AimedDepartureTime>${expected}</siri:MonitoredCall></siri:MonitoredVehicleJourney></siri:MonitoredStopVisit>`;
  };
  const visits = [
    visit('03', 'Centre-ville', 9),
    visit('03', 'Lycée', 11),
    visit('03', 'Centre-ville', 24),
    visit('03', 'Lycée', 26),
    visit('A', 'Verneau - voie 2', 13, false),
    visit('A', 'Verneau - voie 2', 21, false),
  ];
  return new Response(`<siri:Status>true</siri:Status>${visits.join('')}`);
}

/**
 * Produits fictifs (codes à clé juste, marques inventées), rangés par base comme dans Open Food Facts et ses sœurs.
 * `DOCS_UNKNOWN` n'est dans aucune base : il passe par la saisie à la main.
 */
export const DOCS_PRODUCTS = {
  lait: '3000000000014',
  pates: '3000000000021',
  cafe: '3000000000038',
  shampooing: '3000000000045',
  lessive: '3000000000052',
  riz: '3000000000069',
} as const;
export const DOCS_UNKNOWN = '3000000000076';
const PRODUCT_BASES: Record<string, Record<string, Record<string, string>>> = {
  'world.openfoodfacts.org': {
    [DOCS_PRODUCTS.lait]: { product_name_fr: 'Lait demi-écrémé', brands: 'Laiterie du Val', quantity: '1 L' },
    [DOCS_PRODUCTS.pates]: { product_name_fr: 'Coquillettes', brands: 'Moulin d’Anjou', quantity: '500 g' },
    [DOCS_PRODUCTS.cafe]: { product_name_fr: 'Café moulu pur arabica', brands: 'Torréfaction des Halles', quantity: '250 g' },
    [DOCS_PRODUCTS.riz]: { product_name_fr: 'Riz basmati', brands: 'Moulin d’Anjou', quantity: '1 kg' },
  },
  'world.openbeautyfacts.org': {
    [DOCS_PRODUCTS.shampooing]: { product_name_fr: 'Shampooing doux', brands: 'Bain de Loire', quantity: '250 ml' },
  },
  'world.openproductsfacts.org': {
    [DOCS_PRODUCTS.lessive]: { product_name_fr: 'Lessive liquide', brands: 'Clair', quantity: '1,5 L' },
  },
};

function fakeProductBase(url: URL): Response {
  const code = /\/api\/v2\/product\/(\d+)/u.exec(url.pathname)?.[1] ?? '';
  const product = PRODUCT_BASES[url.hostname][code];
  return product
    ? new Response(JSON.stringify({ status: 1, product }), { headers: { 'content-type': 'application/json' } })
    : new Response(JSON.stringify({ status: 0 }), { status: 404 });
}

/**
 * Calendrier scolaire d'exemple (académie de Nantes, zone B, comme Angers), au format de l'export JSON de
 * data.education.gouv.fr : la fixture des tests, sans appel au vrai service.
 */
function fakeSchoolCalendar(): Response {
  return new Response(readFileSync(new URL('../../server/sources/fixtures/calendrier-scolaire.json', import.meta.url), 'utf8'), {
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Remplace ÉcoleDirecte, le temps réel Irigo, les bases de produits, le calendrier scolaire et les sites de recettes
 * par des réponses d'exemple ; le reste passe au vrai `fetch`.
 */
export function installFakeSources(): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname === 'api.ecoledirecte.com') return fakeEcoleDirecte(url);
    if (url.hostname === 'ara-api.enroute.mobi') return fakeSiri();
    if (url.hostname in PRODUCT_BASES) return fakeProductBase(url);
    if (url.hostname === 'data.education.gouv.fr') return fakeSchoolCalendar();
    if (url.hostname === RECIPE_HOST) return fakeRecipeSite(url);
    return realFetch(input, init);
  }) as typeof fetch;
  process.env.ECOLEDIRECTE_IDENTIFIANT = 'docs';
  process.env.ECOLEDIRECTE_MOTDEPASSE = 'docs';
}
