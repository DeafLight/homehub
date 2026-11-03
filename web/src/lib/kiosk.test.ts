import { describe, expect, it, vi } from 'vitest';
import { createApi } from './api.ts';
import { loadKioskKey, takeKioskKeyFromUrl } from './kiosk.ts';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

const fakeWindow = (pathname: string, hash: string) => {
  const replaceState = vi.fn();
  return { win: { location: { pathname, search: '', hash }, history: { replaceState } } as never, replaceState };
};

describe('clé de la tablette', () => {
  it('lue dans #key=…, gardée, puis retirée de l’adresse', () => {
    const storage = memoryStorage();
    const { win, replaceState } = fakeWindow('/', '#key=cle-secrete');
    expect(takeKioskKeyFromUrl(win, storage)).toBe(true);
    expect(loadKioskKey(storage)).toBe('cle-secrete');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('un autre fragment (code d’appairage du téléphone) n’est pas touché', () => {
    const { win, replaceState } = fakeWindow('/appairer', '#AbC123');
    expect(takeKioskKeyFromUrl(win, memoryStorage())).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('envoyée avec chaque requête', async () => {
    const fetchFn = vi.fn(async () => Response.json({ protected: [], parent: false }));
    await createApi(fetchFn, '/api', () => ({ kioskKey: 'cle-secrete' })).pairingPins();
    expect(fetchFn).toHaveBeenCalledWith('/api/pairing/pins', { headers: { 'X-Kiosk-Key': 'cle-secrete' } });
  });
});
