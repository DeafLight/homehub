import { describe, expect, it } from 'vitest';
import { createOpenFoodFactsClient } from './open-food-facts.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('bases de produits (Open Food Facts…)', () => {
  it('lit nom, première marque et contenance, avec un User-Agent', async () => {
    const calls: { url: string; agent: string | null }[] = [];
    const base = createOpenFoodFactsClient({
      userAgent: 'HomeHub/test',
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), agent: new Headers(init?.headers).get('User-Agent') });
        return json({ status: 1, product: { product_name_fr: ' Purée de  pomme ', brands: 'Carrefour Kids, Carrefour', quantity: '4 x 90 g' } });
      },
    });
    expect(await base.find('3560070446117')).toEqual({
      info: { name: 'Purée de pomme', brand: 'Carrefour Kids', quantity: '4 x 90 g' },
      image: null,
      base: 'open-food-facts',
    });
    expect(calls[0].url).toContain('world.openfoodfacts.org/api/v2/product/3560070446117');
    expect(calls[0].agent).toBe('HomeHub/test');
  });

  it('cherche ensuite dans l’hygiène et les autres produits ; absent partout : null', async () => {
    const hosts: string[] = [];
    const base = createOpenFoodFactsClient({
      userAgent: 'HomeHub/test',
      fetchFn: async (url) => {
        hosts.push(new URL(String(url)).host);
        return new URL(String(url)).host === 'world.openproductsfacts.org'
          ? json({ status: 1, product: { product_name: 'Lessive' } })
          : json({ status: 0 }, 404);
      },
    });
    expect((await base.find('3017620422003'))?.base).toBe('open-products-facts');
    expect(hosts).toEqual(['world.openfoodfacts.org', 'world.openbeautyfacts.org', 'world.openproductsfacts.org']);

    const none = createOpenFoodFactsClient({ userAgent: 'x', fetchFn: async () => json({ status: 0 }, 404) });
    expect(await none.find('4006381333931')).toBeNull();
  });

  it('aucune base ne répond : erreur (le produit se saisit alors à la main)', async () => {
    const down = createOpenFoodFactsClient({ userAgent: 'x', fetchFn: async () => json({}, 503) });
    await expect(down.find('4006381333931')).rejects.toThrow('503');
  });
});
