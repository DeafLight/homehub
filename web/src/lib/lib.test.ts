import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api.ts';
import { mix, textColorOn } from './color.ts';
import { dashboardPath, detailPath, parseRoute, routePath } from './route.ts';

const weatherPath = (from: Parameters<typeof detailPath>[1]) => detailPath('weather', from);

describe('route', () => {
  it.each([
    ['/', { name: 'home' }],
    ['/p/lea', { name: 'dashboard', ownerId: 'lea' }],
    ['/p/lea/', { name: 'dashboard', ownerId: 'lea' }],
    ['/autre', { name: 'home' }],
    ['/p/%E0', { name: 'home' }],
    ['/meteo', { name: 'weather', back: { name: 'home' } }],
    ['/meteo/', { name: 'weather', back: { name: 'home' } }],
    ['/meteo/p/lea', { name: 'weather', back: { name: 'dashboard', ownerId: 'lea' } }],
    ['/meteo/autre', { name: 'weather', back: { name: 'home' } }],
    ['/meteorite', { name: 'home' }],
    ['/semaine', { name: 'week', back: { name: 'home' } }],
    ['/semaine/p/lea', { name: 'week', back: { name: 'dashboard', ownerId: 'lea' } }],
  ])('%s', (path, expected) => {
    expect(parseRoute(path)).toEqual(expected);
  });

  it('aller-retour', () => {
    expect(parseRoute(dashboardPath('famille'))).toEqual({ name: 'dashboard', ownerId: 'famille' });
  });

  it('la météo revient à la page qui l’a ouverte', () => {
    expect(weatherPath({ name: 'home' })).toBe('/meteo');
    expect(weatherPath({ name: 'dashboard', ownerId: 'léa' })).toBe('/meteo/p/l%C3%A9a');
    expect(parseRoute(weatherPath({ name: 'dashboard', ownerId: 'léa' }))).toEqual({
      name: 'weather',
      back: { name: 'dashboard', ownerId: 'léa' },
    });
    // Depuis la météo elle-même, le retour ne change pas.
    expect(weatherPath(parseRoute('/meteo/p/lea'))).toBe('/meteo/p/lea');
    expect(routePath({ name: 'home' })).toBe('/');
    // De la météo vers la semaine : on garde la page d'origine.
    expect(detailPath('week', parseRoute('/meteo/p/lea'))).toBe('/semaine/p/lea');
  });
});

describe('color', () => {
  it('mix', () => {
    expect(mix('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mix('#5b8def', '#0f1115', 0)).toBe('#0f1115');
  });

  it('textColorOn', () => {
    expect(textColorOn('#f2b84b')).toBe('#0f1115');
    expect(textColorOn('#1a237e')).toBe('#ffffff');
  });
});

describe('api', () => {
  it('lève une ApiError avec le message du serveur', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: 'Profil inconnu' }), { status: 404 }));
    const api = createApi(fetchFn);
    await expect(api.dashboard('x')).rejects.toEqual(new ApiError(404, 'Profil inconnu'));
    expect(fetchFn).toHaveBeenCalledWith('/api/dashboard/x', undefined);
  });

  it('envoie la mise à jour d’une tâche en PUT', async () => {
    const fetchFn = vi.fn(async () => Response.json({ id: 't1', label: 'x', done: true }));
    await createApi(fetchFn).setTaskDone('alex', 't1', true);
    expect(fetchFn).toHaveBeenCalledWith('/api/dashboard/alex/tasks/t1', expect.objectContaining({ method: 'PUT', body: '{"done":true}' }));
  });
});
