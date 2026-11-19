// Tests du rechargement nocturne de la tablette : heure réglée, fenêtre, nuit déjà faite, personne là, téléphone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastSlot, nightKey, nightlyReloadDue, type NightlyState, parseReloadTime, watchNightlyReload } from './nightly-reload.ts';

/** Date locale (les tests passent aussi avec TZ=UTC). */
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const MIN = 60_000;

function state(over: Partial<NightlyState> = {}): NightlyState {
  return {
    now: at(20, 3, 1),
    at: { hours: 3, minutes: 0 },
    loadedAt: at(19, 14).getTime(),
    doneNight: null,
    phone: false,
    asleep: true,
    present: false,
    lastActivity: at(19, 23).getTime(),
    ...over,
  };
}

describe('parseReloadTime', () => {
  it('lit « HH:MM », refuse le reste', () => {
    expect(parseReloadTime('03:00')).toEqual({ hours: 3, minutes: 0 });
    expect(parseReloadTime(' 4:30 ')).toEqual({ hours: 4, minutes: 30 });
    for (const bad of ['', null, undefined, '25:00', '03:75', 'trois heures']) expect(parseReloadTime(bad)).toBeNull();
  });
});

describe('lastSlot', () => {
  it('aujourd’hui si l’heure est passée, hier sinon', () => {
    expect(lastSlot(at(20, 3, 30), { hours: 3, minutes: 0 })).toEqual(at(20, 3));
    expect(lastSlot(at(20, 2, 59), { hours: 3, minutes: 0 })).toEqual(at(19, 3));
    expect(nightKey(at(20, 3))).toBe('2026-11-20');
  });
});

describe('nightlyReloadDue', () => {
  it('recharge vers 3 h quand la veille est affichée', () => {
    expect(nightlyReloadDue(state())).toBe('2026-11-20');
  });

  it('pas avant l’heure, ni après la fenêtre', () => {
    expect(nightlyReloadDue(state({ now: at(20, 2, 59) }))).toBeNull();
    expect(nightlyReloadDue(state({ now: at(20, 5, 1) }))).toBeNull();
    expect(nightlyReloadDue(state({ now: at(20, 4, 59) }))).toBe('2026-11-20');
  });

  it('pas deux fois la même nuit', () => {
    expect(nightlyReloadDue(state({ doneNight: '2026-11-20' }))).toBeNull();
    expect(nightlyReloadDue(state({ doneNight: '2026-11-19' }))).toBe('2026-11-20');
    // page chargée après l'heure (rechargement fait, ou déploiement) : rien
    expect(nightlyReloadDue(state({ now: at(20, 3, 30), loadedAt: at(20, 3, 2).getTime() }))).toBeNull();
  });

  it('reporté tant que quelqu’un est là', () => {
    expect(nightlyReloadDue(state({ present: true }))).toBeNull();
    const now = at(20, 3, 5);
    expect(nightlyReloadDue(state({ now, asleep: false, lastActivity: now.getTime() - 2 * MIN }))).toBeNull();
    // sans veille (désactivée), dix minutes sans contact ni visage suffisent
    expect(nightlyReloadDue(state({ now, asleep: false, lastActivity: now.getTime() - 10 * MIN }))).toBe('2026-11-20');
  });

  it('jamais sur un téléphone ni sans heure réglée', () => {
    expect(nightlyReloadDue(state({ phone: true }))).toBeNull();
    expect(nightlyReloadDue(state({ at: null }))).toBeNull();
  });
});

describe('watchNightlyReload', () => {
  afterEach(() => vi.useRealTimers());

  function memoryStorage() {
    const items = new Map<string, string>();
    return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
  }

  it('recharge une seule fois dans la nuit, après le départ de la personne', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(20, 2, 58));
    const reload = vi.fn();
    const storage = memoryStorage();
    let present = true;
    const stop = watchNightlyReload({
      at: '03:00',
      state: () => ({ phone: false, asleep: !present, present, lastActivity: 0 }),
      reload,
      storage,
    });
    vi.advanceTimersByTime(10 * MIN); // 3 h 08 : quelqu'un est là
    expect(reload).not.toHaveBeenCalled();
    present = false;
    vi.advanceTimersByTime(MIN);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem('homehub:nightlyReload')).toBe('2026-11-20');
    vi.advanceTimersByTime(30 * MIN); // la même page (rechargement sans effet) ne recharge pas encore
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('rien sans heure réglée, ni sur un téléphone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(20, 2, 58));
    const reload = vi.fn();
    watchNightlyReload({ at: null, state: () => ({ phone: false, asleep: true, present: false, lastActivity: 0 }), reload, storage: null });
    watchNightlyReload({ at: '03:00', state: () => ({ phone: true, asleep: true, present: false, lastActivity: 0 }), reload, storage: null });
    vi.advanceTimersByTime(60 * MIN);
    expect(reload).not.toHaveBeenCalled();
  });

  it('stockage indisponible : l’heure de chargement évite de boucler', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(20, 3, 10));
    const reload = vi.fn();
    const broken = {
      getItem: () => {
        throw new Error('refusé');
      },
      setItem: () => {
        throw new Error('refusé');
      },
    };
    // page rechargée à 3 h 10 : chargée après l'échéance, plus rien cette nuit
    watchNightlyReload({ at: '03:00', state: () => ({ phone: false, asleep: true, present: false, lastActivity: 0 }), reload, storage: broken });
    vi.advanceTimersByTime(60 * MIN);
    expect(reload).not.toHaveBeenCalled();
  });
});
