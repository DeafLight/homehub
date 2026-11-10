// Tests de la recherche d'adresse : requête envoyée à la Géoplateforme (faux service) et lecture de la réponse.
import { describe, expect, it } from 'vitest';
import { GEOCODE_URL, searchAddress } from './geocode.ts';

function fakeFetch(body: unknown, status = 200) {
  const urls: URL[] = [];
  const fetchFn = (async (url: URL) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
}

const feature = (label: string | undefined, coordinates: unknown) => ({ properties: { label }, geometry: { coordinates } });

describe('searchAddress', () => {
  it('envoie l’adresse tapée et le centre arrondi, sans rien d’autre', async () => {
    const { fetchFn, urls } = fakeFetch({ features: [] });
    await searchAddress('1 place du Ralliement', { lat: 47.471234, lon: -0.554321 }, fetchFn);
    const url = urls[0] as URL;
    expect(`${url.origin}${url.pathname}`).toBe(GEOCODE_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '1 place du Ralliement', index: 'address', limit: '5', lat: '47.471', lon: '-0.554' });
  });

  it('sans centre, pas de position dans la requête', async () => {
    const { fetchFn, urls } = fakeFetch({});
    expect(await searchAddress('rue des Lices', undefined, fetchFn)).toEqual([]);
    expect(urls[0]?.searchParams.has('lat')).toBe(false);
  });

  it('lit les adresses (longitude puis latitude) et écarte les réponses incomplètes', async () => {
    const { fetchFn } = fakeFetch({
      features: [
        feature('1 Place du Ralliement 49100 Angers', [-0.5541, 47.4712]),
        feature(undefined, [-0.55, 47.47]),
        feature('Sans position', []),
        feature('Position invalide', ['x', 47.47]),
        {},
      ],
    });
    expect(await searchAddress('ralliement', undefined, fetchFn)).toEqual([{ label: '1 Place du Ralliement 49100 Angers', lat: 47.4712, lon: -0.5541 }]);
  });

  it('signale un service en erreur', async () => {
    const { fetchFn } = fakeFetch({}, 503);
    await expect(searchAddress('angers', undefined, fetchFn)).rejects.toThrow('HTTP 503');
  });
});
