import { describe, expect, it } from 'vitest';
import { PHONE_STOCK_PATH, holdsActor, isPhoneRoute, parseRoute, routePath } from './route.ts';

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

describe('sport du téléphone', () => {
  it('est un onglet de l’appli, à son adresse', () => {
    expect(parseRoute('/m/sport')).toEqual({ name: 'phone', tab: 'sport' });
    expect(routePath({ name: 'phone', tab: 'sport' })).toBe('/m/sport');
  });
});

describe('sport de la tablette', () => {
  it('page Sport et séance guidée, avec le profil d’où elles sont parties', () => {
    expect(parseRoute('/sport/p/alex')).toEqual({ name: 'sport', back: { name: 'dashboard', ownerId: 'alex' } });
    expect(routePath({ name: 'workout', back: { name: 'dashboard', ownerId: 'alex' } })).toBe('/seance/p/alex');
    expect(parseRoute('/semaine')).toMatchObject({ name: 'week' });
  });

  it('la séance guidée retient la personne reconnue, comme le scanner ; pas la page Sport', () => {
    expect(holdsActor(parseRoute('/seance/p/alex'))).toBe(true);
    expect(holdsActor(parseRoute('/scanner'))).toBe(true);
    expect(holdsActor(parseRoute('/sport/p/alex'))).toBe(false);
  });
});
