// Appelle `onIdle` après `timeoutMs` sans interaction. Renvoie la fonction d'arrêt.

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

export function watchIdle(timeoutMs: number, onIdle: () => void, target: EventTarget = window): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(onIdle, timeoutMs);
  };

  for (const type of ACTIVITY_EVENTS) target.addEventListener(type, reset, { passive: true });
  reset();

  return () => {
    clearTimeout(timer);
    for (const type of ACTIVITY_EVENTS) target.removeEventListener(type, reset);
  };
}
