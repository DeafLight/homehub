// Garde du scanner : un code lu compte une fois, puis le scanner attend que le produit soit retiré (plus aucun code
// devant la caméra pendant `clearMs`) avant d'en accepter un autre. Deux yaourts identiques passés l'un après l'autre
// comptent donc deux fois, mais un paquet laissé devant la caméra ne compte qu'une fois.

export const CLEAR_MS = 900;

export type ReadGate = {
  /** « ready » : prêt à lire ; « hold » : un code vient d'être lu, il faut retirer le produit. */
  readonly state: 'ready' | 'hold';
  /** Une image analysée et les codes (valides) vus dessus : le code à traiter, ou null. */
  frame(codes: string[], now: number): string | null;
  /** Après une question à l'écran : ce qui est encore devant la caméra doit d'abord être retiré. */
  hold(now: number): void;
};

export function createReadGate(clearMs = CLEAR_MS): ReadGate {
  let state: 'ready' | 'hold' = 'ready';
  let lastSeen = 0;
  return {
    get state() {
      return state;
    },
    frame(codes, now) {
      if (state === 'ready') {
        if (codes.length === 0) return null;
        state = 'hold';
        lastSeen = now;
        return codes[0];
      }
      if (codes.length > 0) lastSeen = now;
      else if (now - lastSeen >= clearMs) state = 'ready';
      return null;
    },
    hold(now) {
      state = 'hold';
      lastSeen = now;
    },
  };
}
