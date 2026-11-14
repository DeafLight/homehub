// Tests des commandes de la télé depuis la tablette : boutons selon l'état et le volume (fixe : pause seulement),
// explications, qui peut commander (parent reconnu, code parent, personne).
import { describe, expect, it } from 'vitest';
import { commander, MEDIA_DONE, mediaButtons, mediaHint, VOLUME_FIXED_HINT, volumeHint } from './tv-media.ts';

describe('commandes de la télé sur la tablette', () => {
  it('boutons selon l’état et le volume', () => {
    expect(mediaButtons({ power: 'on', control: 'adb', volume: 'adjustable' })).toEqual({ pause: true, volume: true });
    expect(mediaButtons({ power: 'on', control: 'accessibility', volume: null })).toEqual({ pause: true, volume: true });
    expect(mediaButtons({ power: 'standby', control: 'adb', volume: 'fixed' })).toEqual({ pause: true, volume: false });
    expect(mediaButtons({ power: 'offline', control: null, volume: null })).toEqual({ pause: false, volume: false });
    expect(mediaButtons({ power: 'on', control: 'none', volume: 'adjustable' })).toEqual({ pause: false, volume: false });
  });

  it('explications : injoignable, appli ancienne, volume fixe', () => {
    expect(mediaHint({ power: 'offline', control: null, volume: null })).toContain('ne répond pas');
    expect(mediaHint({ power: 'on', control: null, volume: null })).toContain('trop ancienne');
    expect(mediaHint({ power: 'on', control: 'adb', volume: 'fixed' })).toBe(VOLUME_FIXED_HINT);
    expect(mediaHint({ power: 'on', control: 'adb', volume: 'adjustable' })).toBeNull();
    expect(volumeHint('fixed')).toContain('barre de son');
    expect(volumeHint(null)).toBeNull();
  });

  it('qui commande : parent reconnu, sinon code parent, sinon personne', () => {
    expect(commander({ parent: true }, false)).toBe('parent');
    expect(commander({ parent: false }, true)).toBe('code');
    expect(commander(null, true)).toBe('code');
    expect(commander(null, false)).toBe('nobody');
  });

  it('compte rendu de chaque commande', () => {
    expect(MEDIA_DONE.dinner).toContain('À table !');
    expect(MEDIA_DONE.play).toBe('Lecture reprise');
  });
});
