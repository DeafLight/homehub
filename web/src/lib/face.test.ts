// Tests du choix du moteur de calcul des empreintes (faces.backend).
import { describe, expect, it } from 'vitest';
import { engineFor } from './face.ts';

describe('moteur des empreintes', () => {
  it('carte graphique par défaut, sans réglage particulier', () => {
    expect(engineFor('webgl')).toEqual({ backend: 'webgl', flags: {} });
  });

  it('mode sûr : carte graphique sans noyaux empaquetés ni optimisations de Human', () => {
    expect(engineFor('webgl-safe')).toEqual({
      backend: 'webgl',
      flags: { WEBGL_PACK: false, WEBGL_USE_SHAPES_UNIFORMS: false, WEBGL_EXP_CONV: false },
    });
  });

  it('processeur : sans carte graphique', () => {
    expect(engineFor('cpu')).toEqual({ backend: 'cpu', flags: {} });
  });
});
