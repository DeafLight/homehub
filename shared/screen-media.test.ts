// Tests des règles communes du partage vers la télé : genre d'un fichier d'après son type, titre du bandeau.
import { describe, expect, it } from 'vitest';
import { screenMediaKind, screenMediaTitle } from './screen-media.ts';

describe('screenMediaKind', () => {
  it('photo, vidéo, ou refusé', () => {
    expect(screenMediaKind('image/jpeg')).toBe('photo');
    expect(screenMediaKind('IMAGE/HEIC')).toBe('photo');
    expect(screenMediaKind('video/mp4; codecs="avc1"')).toBe('video');
    expect(screenMediaKind('image/svg+xml')).toBeNull();
    expect(screenMediaKind('application/pdf')).toBeNull();
    expect(screenMediaKind('')).toBeNull();
    expect(screenMediaKind(undefined)).toBeNull();
  });
});

describe('screenMediaTitle', () => {
  it('élision devant une voyelle, sans prénom : le genre seul', () => {
    expect(screenMediaTitle('photo', 'Alex')).toBe('Photo d’Alex');
    expect(screenMediaTitle('video', 'Sam')).toBe('Vidéo de Sam');
    expect(screenMediaTitle('photo', null)).toBe('Photo');
  });
});
