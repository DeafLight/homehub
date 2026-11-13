// Tests des textes du bandeau de la tablette pendant une diffusion de la caméra en direct : qui regarde, qui parle.
import { describe, expect, it } from 'vitest';
import { cameraBanner, liveBanner, talkBanner } from './camera.ts';

describe('bandeau de la caméra en direct', () => {
  it('rien sans diffusion ; chaque parent une fois', () => {
    expect(liveBanner([])).toBeNull();
    expect(liveBanner(['Alex'])).toBe('Caméra en direct · Alex');
    expect(liveBanner(['Alex', 'Sam', 'Alex'])).toBe('Caméra en direct · Alex, Sam');
  });

  it('qui parle : au singulier, au pluriel, rien sinon', () => {
    expect(talkBanner([])).toBeNull();
    expect(talkBanner(['Alex'])).toBe('Alex parle');
    expect(talkBanner(['Alex', 'Sam', 'Alex'])).toBe('Alex, Sam parlent');
  });

  it('qui parle passe avant qui regarde, et s’affiche même bandeau coupé', () => {
    expect(cameraBanner(['Alex'], [], true)).toEqual({ text: 'Caméra en direct · Alex', talk: false });
    expect(cameraBanner(['Alex'], [], false)).toBeNull();
    expect(cameraBanner(['Alex', 'Sam'], ['Alex'], true)).toEqual({ text: 'Alex parle', talk: true });
    expect(cameraBanner(['Alex'], ['Alex'], false)).toEqual({ text: 'Alex parle', talk: true });
  });
});
