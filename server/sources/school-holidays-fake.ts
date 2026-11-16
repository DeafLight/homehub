// Faux data.education.gouv.fr du monde fictif (tests et captures de la doc) : sert un calendrier scolaire d'exemple
// par pages de 100 lignes, avec les mêmes refus que l'API anonyme réelle (401 dès qu'une requête n'est pas
// exactement `limit=100&offset=<multiple de 100>`, filtre, tri ou export compris).
import { readFileSync } from 'node:fs';
import { HOLIDAYS_API_URL, HOLIDAYS_PAGE_SIZE } from './school-holidays.ts';

/** Fixture des tests : académie de Nantes (zone B, comme Angers) et quelques lignes d'autres académies. */
export function readHolidaysFixture(): unknown[] {
  return JSON.parse(readFileSync(new URL('./fixtures/calendrier-scolaire.json', import.meta.url), 'utf8'));
}

/** Réponse de l'API pour `url` sur le jeu `records` : une page, ou 401 comme le vrai service. */
export function fakeHolidaysPage(records: unknown[], url: URL | string): Response {
  const u = new URL(String(url));
  const keys = [...u.searchParams.keys()];
  const limit = u.searchParams.get('limit');
  const offset = Number(u.searchParams.get('offset') ?? '0');
  const accepted =
    `${u.origin}${u.pathname}` === HOLIDAYS_API_URL &&
    limit === String(HOLIDAYS_PAGE_SIZE) &&
    keys[0] === 'limit' &&
    keys.every((k) => k === 'limit' || k === 'offset') &&
    Number.isInteger(offset) &&
    offset % HOLIDAYS_PAGE_SIZE === 0;
  if (!accepted) return new Response(null, { status: 401 });
  return Response.json({ total_count: records.length, results: records.slice(offset, offset + HOLIDAYS_PAGE_SIZE) });
}
