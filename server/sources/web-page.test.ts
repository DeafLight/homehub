// Tests de la lecture sûre d'une page (SSRF) : adresses publiques seulement, redirections revérifiées, taille et
// délai limités, hôtes autorisés nommément. Aucune connexion réelle : DNS et fetch simulés.
import { describe, expect, it } from 'vitest';
import { checkTarget, createPageFetcher, isPublicAddress, type PageError } from './web-page.ts';

const dns: Record<string, string[]> = {
  'cuisine.exemple.test': ['93.184.216.34'],
  'piege.exemple.test': ['93.184.216.34', '192.168.1.10'],
  'interne.exemple.test': ['10.0.0.5'],
  'v6.exemple.test': ['2606:2800:220:1::1'],
  'boucle.exemple.test': ['::1'],
};
const lookup = async (host: string) => dns[host] ?? Promise.reject(new Error('ENOTFOUND'));
const check = (url: string, allowedHosts: string[] = []) => checkTarget(url, { allowedHosts, lookup });
const refusal = (promise: Promise<unknown>) => promise.then(() => null, (err: PageError) => err.kind);

describe('isPublicAddress', () => {
  it.each([
    ['93.184.216.34', true],
    ['2606:2800:220:1::1', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.20.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.1.1', false],
    ['0.0.0.0', false],
    ['::1', false],
    ['::', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:192.168.1.1', false],
    ['::ffff:93.184.216.34', true],
    ['64:ff9b::10.0.0.1', false],
    ['pas une adresse', false],
  ])('%s → %s', (address, expected) => expect(isPublicAddress(address)).toBe(expected));
});

describe('checkTarget', () => {
  it('accepte un site public en http ou https', async () => {
    expect((await check('https://cuisine.exemple.test/recette')).hostname).toBe('cuisine.exemple.test');
    expect((await check('http://v6.exemple.test/')).hostname).toBe('v6.exemple.test');
  });

  it.each([
    ['ftp://cuisine.exemple.test/', 'invalid'],
    ['file:///etc/passwd', 'invalid'],
    ['pas une adresse', 'invalid'],
    ['https://moi:secret@cuisine.exemple.test/', 'invalid'],
    ['https://cuisine.exemple.test:8443/', 'forbidden'],
    ['http://127.0.0.1/', 'forbidden'],
    ['http://[::1]/', 'forbidden'],
    ['http://192.168.1.20/admin', 'forbidden'],
    ['http://169.254.169.254/latest/meta-data', 'forbidden'],
    ['http://localhost/', 'forbidden'],
    ['http://nas.local/', 'forbidden'],
    ['http://routeur/', 'forbidden'],
    ['https://interne.exemple.test/', 'forbidden'],
    ['https://piege.exemple.test/', 'forbidden'],
    ['https://boucle.exemple.test/', 'forbidden'],
    ['https://inconnu.exemple.test/', 'unreachable'],
  ])('%s → %s', async (url, kind) => expect(await refusal(check(url))).toBe(kind));

  it('un hôte autorisé nommément passe, port compris', async () => {
    expect((await check('http://mealie.local:9000/recipe/1', ['mealie.local'])).port).toBe('9000');
  });
});

/** fetch simulé : une réponse par adresse. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    expect(init?.redirect).toBe('manual');
    const route = routes[url];
    if (!route) throw new Error(`inattendu : ${url}`);
    return route();
  }) as typeof fetch;
  return { fn, calls };
}

describe('createPageFetcher', () => {
  const make = (routes: Record<string, () => Response>, extra: Partial<Parameters<typeof createPageFetcher>[0]> = {}) => {
    const fake = fakeFetch(routes);
    return { get: createPageFetcher({ fetchFn: fake.fn, lookup, userAgent: 'HomeHub/test', ...extra }), calls: fake.calls };
  };

  it('lit une page et donne l’adresse finale', async () => {
    const { get } = make({ 'https://cuisine.exemple.test/a': () => new Response('<html>ok</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) });
    const page = await get('https://cuisine.exemple.test/a');
    expect(page.url).toBe('https://cuisine.exemple.test/a');
    expect(page.contentType).toContain('text/html');
    expect(new TextDecoder().decode(page.body)).toBe('<html>ok</html>');
  });

  it('suit une redirection vers un site public', async () => {
    const { get, calls } = make({
      'https://cuisine.exemple.test/court': () => new Response(null, { status: 301, headers: { location: '/long' } }),
      'https://cuisine.exemple.test/long': () => new Response('fin'),
    });
    expect((await get('https://cuisine.exemple.test/court')).url).toBe('https://cuisine.exemple.test/long');
    expect(calls).toHaveLength(2);
  });

  it('refuse une redirection vers le réseau local, sans la suivre', async () => {
    const { get, calls } = make({ 'https://cuisine.exemple.test/r': () => new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/' } }) });
    expect(await refusal(get('https://cuisine.exemple.test/r'))).toBe('forbidden');
    expect(calls).toEqual(['https://cuisine.exemple.test/r']);
  });

  it('s’arrête après trop de redirections', async () => {
    const { get } = make({ 'https://cuisine.exemple.test/boucle': () => new Response(null, { status: 302, headers: { location: '/boucle' } }) });
    expect(await refusal(get('https://cuisine.exemple.test/boucle'))).toBe('unreachable');
  });

  it('coupe une page trop lourde, annoncée ou non', async () => {
    const big = 'x'.repeat(2000);
    const { get } = make({
      'https://cuisine.exemple.test/annoncee': () => new Response(big, { headers: { 'content-length': '2000' } }),
      'https://cuisine.exemple.test/flux': () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } })),
    });
    expect(await refusal(get('https://cuisine.exemple.test/annoncee', { maxBytes: 1000 }))).toBe('too-large');
    expect(await refusal(get('https://cuisine.exemple.test/flux', { maxBytes: 1000 }))).toBe('too-large');
  });

  it('page absente, refus du site, site muet', async () => {
    const { get } = make({
      'https://cuisine.exemple.test/absente': () => new Response('', { status: 404 }),
      'https://cuisine.exemple.test/refus': () => new Response('', { status: 403 }),
    });
    expect(await refusal(get('https://cuisine.exemple.test/absente'))).toBe('not-found');
    expect(await refusal(get('https://cuisine.exemple.test/refus'))).toBe('unreachable');
    const slow = createPageFetcher({
      lookup,
      userAgent: 'HomeHub/test',
      timeoutMs: 20,
      fetchFn: ((_: unknown, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abandon'))))) as typeof fetch,
    });
    const err = await slow('https://cuisine.exemple.test/lent').catch((e: PageError) => e);
    expect(err).toMatchObject({ kind: 'unreachable', message: 'Le site met trop de temps à répondre' });
  });

  it('les hôtes autorisés passent sans contrôle d’adresse', async () => {
    const { get } = make({ 'http://mealie.local:9000/r': () => new Response('ok') }, { allowedHosts: () => ['mealie.local'] });
    expect((await get('http://mealie.local:9000/r')).url).toBe('http://mealie.local:9000/r');
  });
});
