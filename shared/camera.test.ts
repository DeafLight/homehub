// Tests du texte du bandeau de la tablette pendant une diffusion de la caméra en direct.
import { describe, expect, it } from 'vitest';
import { liveBanner } from './camera.ts';

describe('bandeau de la caméra en direct', () => {
  it('rien sans diffusion ; chaque parent une fois', () => {
    expect(liveBanner([])).toBeNull();
    expect(liveBanner(['Alex'])).toBe('Caméra en direct · Alex');
    expect(liveBanner(['Alex', 'Sam', 'Alex'])).toBe('Caméra en direct · Alex, Sam');
  });
});
