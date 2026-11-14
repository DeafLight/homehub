import { describe, expect, it } from 'vitest';
import { PHONE_MENU_PATH, PHONE_REMOTE_PATH, phoneScanPath, PHONE_STOCK_PATH, allowsScreensaver, holdsActor, hostsLiveCamera, isPhoneRoute, parseRoute, returnsHomeWhenIdle, routePath, showsTimers, watchesPresence } from './route.ts';

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

describe('menu de la semaine', () => {
  it('a sa page sur la tablette (avec son retour) et sur le téléphone, comme la télécommande de la télé', () => {
    expect(parseRoute('/menu')).toEqual({ name: 'menu', back: { name: 'home' } });
    expect(parseRoute('/menu/p/alex')).toEqual({ name: 'menu', back: { name: 'dashboard', ownerId: 'alex' } });
    expect(parseRoute(PHONE_MENU_PATH)).toEqual({ name: 'phonemenu' });
    expect(routePath({ name: 'phonemenu' })).toBe('/m/menu');
    expect(parseRoute(PHONE_REMOTE_PATH)).toEqual({ name: 'phoneremote' });
    expect(routePath({ name: 'phoneremote' })).toBe('/m/tele');
    expect(isPhoneRoute({ name: 'phoneremote' })).toBe(true);
    expect(isPhoneRoute(parseRoute('/m/menu'))).toBe(true);
    expect(returnsHomeWhenIdle(parseRoute('/menu'))).toBe(true);
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

  it('caméra en direct : diffusée par les pages de la tablette (scanner et visages compris), jamais du téléphone', () => {
    for (const path of ['/', '/p/lea', '/scanner', '/visages', '/recette/abc/cuisine']) expect(hostsLiveCamera(parseRoute(path))).toBe(true);
    for (const path of ['/m', '/m/camera', '/m/scanner', '/appairer', '/partager']) expect(hostsLiveCamera(parseRoute(path))).toBe(false);
  });

  it('la séance guidée retient la personne reconnue, comme le scanner ; pas la page Sport', () => {
    expect(holdsActor(parseRoute('/seance/p/alex'))).toBe(true);
    expect(holdsActor(parseRoute('/scanner'))).toBe(true);
    expect(holdsActor(parseRoute('/sport/p/alex'))).toBe(false);
  });

  it('traits des routes : retour à l’accueil, veille, reconnaissance, minuteurs', () => {
    const traitsOf = (path: string) => {
      const route = parseRoute(path);
      return [returnsHomeWhenIdle(route), allowsScreensaver(route), watchesPresence(route), showsTimers(route)];
    };
    expect(traitsOf('/')).toEqual([true, true, true, true]);
    expect(traitsOf('/p/lea')).toEqual([true, true, true, true]);
    expect(traitsOf('/visages')).toEqual([true, true, false, true]);
    expect(traitsOf('/scanner')).toEqual([false, false, false, true]);
    expect(traitsOf('/seance/p/alex')).toEqual([false, false, false, true]);
    for (const path of ['/m', '/m/sport', '/m/scanner', '/m/stock', '/appairer', '/partager']) {
      expect(traitsOf(path)).toEqual([false, false, false, false]);
    }
  });
});

describe('vacances scolaires', () => {
  it('page de réglage ouverte depuis la roue dentée, avec la page d’où elle part', () => {
    expect(parseRoute('/vacances')).toEqual({ name: 'holidays', back: { name: 'home' } });
    expect(routePath({ name: 'holidays', back: { name: 'dashboard', ownerId: 'alex' } })).toBe('/vacances/p/alex');
  });
});

describe('recettes', () => {
  it('carnet de la tablette, avec la page d’où il part ; onglet du téléphone', () => {
    expect(parseRoute('/recettes')).toEqual({ name: 'recipes', back: { name: 'home' } });
    expect(parseRoute('/recettes/p/alex')).toEqual({ name: 'recipes', back: { name: 'dashboard', ownerId: 'alex' } });
    expect(parseRoute('/m/recettes')).toEqual({ name: 'phone', tab: 'recipes' });
    expect(parseRoute('/m/camera')).toEqual({ name: 'phone', tab: 'camera' });
  });

  it('fiche, édition, mode cuisine et nouvelle recette, aller et retour', () => {
    const cases = [
      ['/recette/abc', { name: 'recipe', id: 'abc', mode: 'view' }],
      ['/recette/abc/modifier', { name: 'recipe', id: 'abc', mode: 'edit' }],
      ['/recette/abc/cuisine', { name: 'recipe', id: 'abc', mode: 'cook' }],
      ['/recette/nouvelle', { name: 'recipe', id: null, mode: 'edit' }],
      ['/m/recette/abc', { name: 'phonerecipe', id: 'abc', mode: 'view' }],
      ['/m/recette/abc/modifier', { name: 'phonerecipe', id: 'abc', mode: 'edit' }],
      ['/m/recette/nouvelle', { name: 'phonerecipe', id: null, mode: 'edit' }],
    ] as const;
    for (const [path, route] of cases) {
      expect(parseRoute(path)).toEqual(route);
      expect(routePath(route)).toBe(path);
    }
    expect(parseRoute('/m/recette/abc/cuisine')).toEqual({ name: 'phonerecipe', id: 'abc', mode: 'view' });
  });

  it('une recette ouverte sur la tablette reste à l’écran, reconnaissance comprise ; le carnet, non', () => {
    const traitsOf = (path: string) => {
      const route = parseRoute(path);
      return [returnsHomeWhenIdle(route), allowsScreensaver(route), watchesPresence(route), showsTimers(route)];
    };
    expect(traitsOf('/recette/abc/cuisine')).toEqual([false, false, true, true]);
    expect(traitsOf('/recette/abc')).toEqual([false, false, true, true]);
    expect(traitsOf('/recettes')).toEqual([true, true, true, true]);
    expect(traitsOf('/m/recette/abc')).toEqual([false, false, false, false]);
  });
});

describe('scanner du téléphone ouvert dans un mode', () => {
  it('lit ?mode=ranger et ?mode=jete, valeurs promises aux affichettes', () => {
    expect(parseRoute('/m/scanner?mode=ranger')).toEqual({ name: 'phonescan', mode: 'in' });
    expect(parseRoute('/m/scanner?mode=jete')).toEqual({ name: 'phonescan', mode: 'out' });
    expect(parseRoute('/m/scanner/?autre=1&mode=jete')).toEqual({ name: 'phonescan', mode: 'out' });
    expect(phoneScanPath('in')).toBe('/m/scanner?mode=ranger');
    expect(phoneScanPath('out')).toBe('/m/scanner?mode=jete');
  });

  it('sans mode, ou avec une valeur inconnue : le scanner habituel', () => {
    for (const path of ['/m/scanner', '/m/scanner?mode=', '/m/scanner?mode=Jete', '/m/scanner?mode=out']) {
      expect(parseRoute(path)).toEqual({ name: 'phonescan' });
    }
    expect(routePath({ name: 'phonescan' })).toBe('/m/scanner');
  });

  it('aller et retour', () => {
    for (const path of ['/m/scanner', '/m/scanner?mode=ranger', '/m/scanner?mode=jete']) expect(routePath(parseRoute(path))).toBe(path);
  });

  it('une requête ne change pas les autres routes', () => {
    expect(parseRoute('/m/stock?mode=jete')).toEqual({ name: 'phonestock' });
    expect(parseRoute('/scanner?mode=jete')).toEqual({ name: 'scan', back: { name: 'home' } });
    expect(parseRoute('/partager?text=bonjour')).toEqual({ name: 'share' });
  });
});
