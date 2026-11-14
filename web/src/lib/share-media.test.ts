// Tests de la page « Montrer sur la télé » : adresse posée par le serveur, taille lisible, compte rendu, télé choisie.
import { describe, expect, it } from 'vitest';
import { defaultTarget, MEDIA_FORMAT_ERROR, MEDIA_TOO_BIG_ERROR, mediaSize, sentNotice, sharedMediaParam } from './share-media.ts';

describe('sharedMediaParam', () => {
  it('numéro du fichier, refus du serveur, ou autre chose', () => {
    expect(sharedMediaParam(new URLSearchParams({ media: 'abc' }))).toEqual({ kind: 'media', id: 'abc' });
    expect(sharedMediaParam(new URLSearchParams({ erreur: 'media-format' }))).toEqual({ kind: 'error', message: MEDIA_FORMAT_ERROR });
    expect(sharedMediaParam(new URLSearchParams({ erreur: 'media-trop-lourd' }))).toEqual({ kind: 'error', message: MEDIA_TOO_BIG_ERROR });
    expect(sharedMediaParam(new URLSearchParams({ erreur: 'trop-lourd' }))).toBeNull();
    expect(sharedMediaParam(new URLSearchParams({ text: 'Bonjour' }))).toBeNull();
  });
});

describe('mediaSize et sentNotice', () => {
  it('ko, Mo à une décimale', () => {
    expect(mediaSize(300)).toBe('1 ko');
    expect(mediaSize(850_000)).toBe('850 ko');
    expect(mediaSize(4_210_000)).toBe('4,2 Mo');
  });
  it('photo affichée, vidéo lancée', () => {
    expect(sentNotice('photo', 'Salon')).toBe('Photo affichée sur Salon');
    expect(sentNotice('video', 'Salon')).toBe('Vidéo lancée sur Salon');
  });
});

describe('defaultTarget', () => {
  it('la seule allumée, sinon la seule télé, sinon aucune', () => {
    const a = { id: 'a', name: 'Salon', online: true };
    const b = { id: 'b', name: 'Chambre', online: false };
    expect(defaultTarget([a, b])).toBe('a');
    expect(defaultTarget([b])).toBe('b');
    expect(defaultTarget([{ ...a, online: false }, b])).toBeNull();
    expect(defaultTarget([])).toBeNull();
  });
});
