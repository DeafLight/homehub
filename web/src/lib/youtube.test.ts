// Tests de la reconnaissance d'un lien YouTube partagé (formes de liens, instant de départ, texte de l'appli) et des
// règles du lecteur de la tablette, puis de la place de la vignette (coins, bords de l'écran, coin retenu).
import { describe, expect, it } from 'vitest';
import { clampPosition, cornerPosition, loadCorner, nearestCorner, saveCorner } from './video-dock.ts';
import { formatStart, parseStart, playerHost, playerVars, playingAfter, sharedYouTube, youTubeFromUrl, youTubeInText } from './youtube.ts';

const ID = 'dQw4w9WgXcQ';

describe('youTubeFromUrl', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, 0],
    [`https://youtube.com/watch?v=${ID}&list=PL123&index=2`, 0],
    [`https://m.youtube.com/watch?v=${ID}&t=42s`, 42],
    [`https://music.youtube.com/watch?v=${ID}`, 0],
    [`https://youtu.be/${ID}?si=AbCdEfGh123`, 0],
    [`https://youtu.be/${ID}?si=AbCdEfGh123&t=90`, 90],
    [`https://www.youtube.com/shorts/${ID}`, 0],
    [`https://youtube.com/shorts/${ID}?si=xyz`, 0],
    [`https://www.youtube.com/live/${ID}?t=1h2m3s`, 3723],
    [`https://www.youtube-nocookie.com/embed/${ID}?start=15`, 15],
    [`http://www.youtube.com/watch?v=${ID}#t=1m30s`, 90],
  ])('%s', (url, start) => {
    expect(youTubeFromUrl(url)).toEqual({ videoId: ID, start });
  });

  it.each([
    'https://www.youtube.com/',
    'https://www.youtube.com/@chaine',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/watch?v=trop-court',
    `https://www.youtube.com/watch?v=${ID}x`,
    `https://youtube.com.example.org/watch?v=${ID}`,
    `https://example.org/watch?v=${ID}`,
    `javascript:alert('${ID}')`,
    'pas une adresse',
  ])('refuse %s', (url) => {
    expect(youTubeFromUrl(url)).toBeNull();
  });

  it('ignore la ponctuation collée à la fin du lien', () => {
    expect(youTubeFromUrl(`https://youtu.be/${ID}).`)).toEqual({ videoId: ID, start: 0 });
  });
});

describe('youTubeInText et sharedYouTube', () => {
  it('trouve le lien dans le texte envoyé par l’appli YouTube', () => {
    expect(youTubeInText(`Regarde ça ! https://youtu.be/${ID}?si=abc`)).toEqual({ videoId: ID, start: 0 });
    expect(youTubeInText('Une recette https://blog.example.org/tarte puis rien')).toBeNull();
    expect(youTubeInText(null)).toBeNull();
  });

  it('passe le premier lien qui n’est pas YouTube', () => {
    expect(youTubeInText(`https://example.org/x https://youtu.be/${ID}`)).toEqual({ videoId: ID, start: 0 });
  });

  it('regarde url, puis text, puis title', () => {
    expect(sharedYouTube(new URLSearchParams({ text: `https://youtu.be/${ID}?t=5` }))).toEqual({ videoId: ID, start: 5 });
    expect(sharedYouTube(new URLSearchParams({ url: `https://www.youtube.com/watch?v=${ID}`, text: 'Titre' }))).toEqual({ videoId: ID, start: 0 });
    expect(sharedYouTube(new URLSearchParams({ title: `https://youtu.be/${ID}` }))).toEqual({ videoId: ID, start: 0 });
    expect(sharedYouTube(new URLSearchParams({ url: 'https://blog.example.org/recette' }))).toBeNull();
  });
});

describe('parseStart et formatStart', () => {
  it.each([
    ['90', 90],
    ['90s', 90],
    ['1m30s', 90],
    ['2m', 120],
    ['1h', 3600],
    ['', 0],
    [null, 0],
    ['abc', 0],
    ['h', 0],
    ['999999', 0],
  ])('%s → %i', (value, seconds) => {
    expect(parseStart(value)).toBe(seconds);
  });

  it('écrit l’instant de départ', () => {
    expect(formatStart(42)).toBe('42 s');
    expect(formatStart(90)).toBe('1 min 30 s');
    expect(formatStart(120)).toBe('2 min');
    expect(formatStart(3723)).toBe('1 h 02 min 03 s');
  });
});

describe('lecteur', () => {
  it('adresse et paramètres', () => {
    expect(playerHost('youtube-nocookie.com')).toBe('https://www.youtube-nocookie.com');
    expect(playerHost('youtube.com')).toBe('https://www.youtube.com');
    expect(playerVars(0)).toEqual({ autoplay: 1, playsinline: 1, rel: 0, fs: 0 });
    expect(playerVars(90)).toMatchObject({ autoplay: 1, start: 90 });
  });

  it('suit la lecture', () => {
    expect(playingAfter(1, false)).toBe(true); // lecture
    expect(playingAfter(3, false)).toBe(true); // chargement
    expect(playingAfter(2, true)).toBe(false); // pause
    expect(playingAfter(0, true)).toBe(false); // fin
    expect(playingAfter(-1, true)).toBe(true); // pas commencée (lecture automatique bloquée) : inchangé
  });
});

describe('vignette', () => {
  const size = { width: 400, height: 300 };
  const viewport = { width: 1280, height: 800 };

  it('se pose dans chaque coin, avec la marge', () => {
    expect(cornerPosition('top-left', size, viewport)).toEqual({ x: 16, y: 16 });
    expect(cornerPosition('bottom-right', size, viewport)).toEqual({ x: 864, y: 484 });
    expect(cornerPosition('top-right', size, viewport)).toEqual({ x: 864, y: 16 });
    expect(cornerPosition('bottom-left', size, viewport)).toEqual({ x: 16, y: 484 });
  });

  it('ne sort pas de l’écran', () => {
    expect(clampPosition({ x: -200, y: 5000 }, size, viewport)).toEqual({ x: 16, y: 484 });
    expect(clampPosition({ x: 300, y: 200 }, size, viewport)).toEqual({ x: 300, y: 200 });
    expect(clampPosition({ x: 300, y: 200 }, size, { width: 300, height: 200 })).toEqual({ x: 16, y: 16 });
  });

  it('se range dans le coin le plus proche', () => {
    expect(nearestCorner({ x: 10, y: 10 }, size, viewport)).toBe('top-left');
    expect(nearestCorner({ x: 700, y: 10 }, size, viewport)).toBe('top-right');
    expect(nearestCorner({ x: 100, y: 400 }, size, viewport)).toBe('bottom-left');
    expect(nearestCorner({ x: 800, y: 450 }, size, viewport)).toBe('bottom-right');
  });

  it('retient le coin', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(loadCorner(storage)).toBe('bottom-right');
    saveCorner('top-left', storage);
    expect(loadCorner(storage)).toBe('top-left');
    data.set('homehub:videoCorner', 'n’importe quoi');
    expect(loadCorner(storage)).toBe('bottom-right');
    expect(loadCorner(null)).toBe('bottom-right');
  });
});
