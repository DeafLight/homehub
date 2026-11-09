import { describe, expect, it } from 'vitest';
import { PHONE_STOCK_PATH, isPhoneRoute, parseRoute, routePath } from './route.ts';

describe('stock du téléphone', () => {
  it('a sa propre adresse, aller et retour', () => {
    expect(parseRoute(PHONE_STOCK_PATH)).toEqual({ name: 'phonestock' });
    expect(routePath({ name: 'phonestock' })).toBe('/m/stock');
  });

  it('compte comme une page du téléphone, à la différence du stock de la tablette', () => {
    expect(isPhoneRoute(parseRoute('/m/stock'))).toBe(true);
    expect(isPhoneRoute(parseRoute('/stock'))).toBe(false);
  });
});
