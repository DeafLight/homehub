// Tests des règles de ce qui passe à la télé (fonction 18) : textes nettoyés, durée en direct oubliée, position qui
// avance seulement en lecture, durées lisibles, type et empreinte de l'image.
import { describe, expect, it } from 'vitest';
import { artworkId, artworkType, cleanDuration, cleanPlayingText, formatPlayTime, NOW_PLAYING_TEXT_MAX, positionAfter } from './now-playing.ts';

describe('ce qui passe à la télé', () => {
  it('textes : espaces et invisibles retirés, vides oubliés, trop longs coupés', () => {
    expect(cleanPlayingText('  Les​Voisins \n du dessus ')).toBe('Les Voisins du dessus');
    expect(cleanPlayingText('‮  ')).toBeNull();
    expect(cleanPlayingText(null)).toBeNull();
    const long = cleanPlayingText('é'.repeat(300))!;
    expect([...long]).toHaveLength(NOW_PLAYING_TEXT_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('durée : 0, -1 ou infinie (télé en direct) oubliée', () => {
    expect(cleanDuration(2_700_000.6)).toBe(2_700_001);
    expect(cleanDuration(0)).toBeNull();
    expect(cleanDuration(-1)).toBeNull();
    expect(cleanDuration(Number.POSITIVE_INFINITY)).toBeNull();
    expect(cleanDuration(null)).toBeNull();
  });

  it('position : avance en lecture sans dépasser la durée, reste en pause, inconnue reste inconnue', () => {
    const p = { state: 'playing' as const, positionMs: 60_000, durationMs: 90_000 };
    expect(positionAfter(p, 10_000)).toBe(70_000);
    expect(positionAfter(p, 60_000)).toBe(90_000);
    expect(positionAfter({ ...p, durationMs: null }, 60_000)).toBe(120_000);
    expect(positionAfter({ ...p, state: 'paused' }, 10_000)).toBe(60_000);
    expect(positionAfter({ ...p, state: 'buffering' }, 10_000)).toBe(60_000);
    expect(positionAfter({ ...p, positionMs: null }, 10_000)).toBeNull();
    expect(positionAfter(p, -5_000)).toBe(60_000);
  });

  it('durées lisibles : minutes, heures seulement s’il y en a', () => {
    expect(formatPlayTime(0)).toBe('0:00');
    expect(formatPlayTime(245_900)).toBe('4:05');
    expect(formatPlayTime(3_130_000)).toBe('52:10');
    expect(formatPlayTime(3_725_000)).toBe('1:02:05');
  });

  it('image : JPEG ou PNG seulement, empreinte stable qui change avec l’image', () => {
    expect(artworkType('/9j/4AAQ')).toBe('image/jpeg');
    expect(artworkType('iVBORw0KGgo=')).toBe('image/png');
    expect(artworkType('PHN2Zz4=')).toBeNull();
    expect(artworkId('/9j/abc')).toBe(artworkId('/9j/abc'));
    expect(artworkId('/9j/abc')).not.toBe(artworkId('/9j/abd'));
  });
});
