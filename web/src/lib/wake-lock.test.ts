// Tests du verrou d'écran : rendu même s'il arrive après la sortie, redemandé quand la page redevient visible.
import { describe, expect, it, vi } from 'vitest';
import { createWakeLock, type VisibilityDocument, type WakeLockSentinel } from './wake-lock.ts';

function fakes() {
  const released: number[] = [];
  const resolvers: ((lock: WakeLockSentinel) => void)[] = [];
  let count = 0;
  const nav = {
    wakeLock: {
      request: vi.fn(
        () =>
          new Promise<WakeLockSentinel>((resolve) => {
            const id = ++count;
            resolvers.push(() => resolve({ release: async () => void released.push(id) }));
          }),
      ),
    },
  };
  const listeners = new Set<() => void>();
  const doc: VisibilityDocument & { show(state: string): void; listeners: Set<() => void> } = {
    visibilityState: 'visible',
    addEventListener: (_t, l) => void listeners.add(l),
    removeEventListener: (_t, l) => void listeners.delete(l),
    show(state) {
      this.visibilityState = state;
      for (const l of listeners) l();
    },
    listeners,
  };
  /** Le navigateur accorde la demande la plus ancienne. */
  const grant = async () => {
    resolvers.shift()?.({ release: async () => {} });
    await new Promise((r) => setTimeout(r, 0));
  };
  return { nav, doc, released, grant };
}

describe('verrou d’écran', () => {
  it('demande le verrou et le rend', async () => {
    const { nav, doc, released, grant } = fakes();
    const lock = createWakeLock(nav, doc);
    lock.acquire();
    lock.acquire();
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
    await grant();
    lock.release();
    await Promise.resolve();
    expect(released).toEqual([1]);
    expect(doc.listeners.size).toBe(0);
  });

  it('accordé après la sortie de la page : rendu aussitôt', async () => {
    const { nav, doc, released, grant } = fakes();
    const lock = createWakeLock(nav, doc);
    lock.acquire();
    lock.release();
    await grant();
    expect(released).toEqual([1]);
  });

  it('redemandé quand la page redevient visible, pas quand elle est cachée', async () => {
    const { nav, doc, released, grant } = fakes();
    const lock = createWakeLock(nav, doc);
    lock.acquire();
    await grant();
    doc.show('hidden');
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
    doc.show('visible');
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
    await grant();
    lock.release();
    await Promise.resolve();
    expect(released).toEqual([2]);
  });

  it('plus rien une fois rendu', () => {
    const { nav, doc } = fakes();
    const lock = createWakeLock(nav, doc);
    lock.acquire();
    lock.release();
    doc.show('hidden');
    doc.show('visible');
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it('sans Wake Lock dans le navigateur : rien ne casse', () => {
    const { doc } = fakes();
    const lock = createWakeLock({}, doc);
    expect(() => {
      lock.acquire();
      lock.release();
    }).not.toThrow();
  });
});
