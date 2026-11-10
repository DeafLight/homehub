// Tests de la couche HTTP commune : refus traduits en `{ error, identify? }`, corps validés, erreurs internes.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRouter, fail, readBody } from './http.ts';

function app() {
  const errors: unknown[][] = [];
  const router = createRouter({ error: (...args: unknown[]) => void errors.push(args) });
  router.post('/fixe', async (c) => c.json(await readBody(c, z.object({ n: z.number() }), 'Corps attendu : { "n": 1 }')));
  router.post('/zod', async (c) => c.json(await readBody(c, z.object({ jour: z.string().regex(/^\d{4}$/, 'année attendue') }))));
  router.get('/qui', () => fail(403, 'Qui es-tu ?', true));
  router.get('/panne', () => {
    throw new Error('disque plein');
  });
  const call = async (method: string, path: string, body?: string) => {
    const res = await router.request(path, { method, headers: { 'Content-Type': 'application/json' }, body });
    return { status: res.status, json: await res.json() };
  };
  return { call, errors };
}

describe('couche HTTP', () => {
  it('lit un corps valide', async () => {
    expect(await app().call('POST', '/fixe', '{"n":3}')).toEqual({ status: 200, json: { n: 3 } });
  });

  it('refuse un corps invalide, absent ou qui n’est pas du JSON, avec le message de la route', async () => {
    const { call } = app();
    for (const body of ['{"n":"3"}', undefined, 'pas du json']) {
      expect(await call('POST', '/fixe', body)).toEqual({ status: 400, json: { error: 'Corps attendu : { "n": 1 }' } });
    }
  });

  it('par défaut, donne le premier problème relevé par zod', async () => {
    expect(await app().call('POST', '/zod', '{"jour":"hier"}')).toEqual({ status: 400, json: { error: 'année attendue' } });
  });

  it('un refus garde son statut, et `identify` seulement quand il le faut', async () => {
    expect(await app().call('GET', '/qui')).toEqual({ status: 403, json: { error: 'Qui es-tu ?', identify: true } });
  });

  it('une autre erreur devient une erreur interne, journalisée sans être montrée', async () => {
    const { call, errors } = app();
    expect(await call('GET', '/panne')).toEqual({ status: 500, json: { error: 'Erreur interne' } });
    expect(errors).toHaveLength(1);
  });
});
