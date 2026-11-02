// Heure courante réactive, partagée par tous les écrans (une seule minuterie).

export type Clock = {
  readonly now: Date;
  destroy(): void;
};

export function createClock(intervalMs = 1000): Clock {
  let now = $state(new Date());
  const timer = setInterval(() => {
    now = new Date();
  }, intervalMs);

  return {
    get now() {
      return now;
    },
    destroy() {
      clearInterval(timer);
    },
  };
}
