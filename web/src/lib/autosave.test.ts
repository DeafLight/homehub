// Tests de l'enregistrement automatique des pages de réglages : attente de fin de saisie, état par zone, problèmes,
// modification pendant un enregistrement.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutoSave, requireParent, type SaveState } from './autosave.ts';

describe('enregistrement automatique', () => {
  let states: SaveState[];
  const last = () => states.at(-1);

  beforeEach(() => {
    vi.useFakeTimers();
    states = [];
  });
  afterEach(() => vi.useRealTimers());

  it('attend la fin de la saisie, enregistre une fois, puis « Enregistré » s’efface', async () => {
    const save = vi.fn(async () => true);
    const auto = createAutoSave({ save, onState: (s) => states.push(s), delayMs: 800, savedMs: 3000 });
    auto.touch('matin');
    await vi.advanceTimersByTimeAsync(500);
    auto.touch('matin');
    expect(last()).toEqual({ kind: 'pending', zone: 'matin' });
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(last()).toEqual({ kind: 'saved', zone: 'matin' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(last()).toEqual({ kind: 'idle' });
  });

  it('l’état suit la dernière zone touchée', async () => {
    const auto = createAutoSave({ save: async () => true, onState: (s) => states.push(s) });
    auto.touch('matin');
    auto.touch('heures');
    await vi.advanceTimersByTimeAsync(1000);
    expect(last()).toEqual({ kind: 'saved', zone: 'heures' });
  });

  it('un brouillon invalide n’est pas envoyé : le problème s’affiche dans la zone', async () => {
    const save = vi.fn(async () => true);
    const auto = createAutoSave({ save, problem: () => 'Une étape sans nom', onState: (s) => states.push(s) });
    auto.touch('soir');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    expect(last()).toEqual({ kind: 'problem', zone: 'soir', text: 'Une étape sans nom' });
  });

  it('un refus du serveur s’affiche dans la zone', async () => {
    const auto = createAutoSave({ save: async () => Promise.reject(new Error('Seul un parent peut enregistrer')), onState: (s) => states.push(s) });
    auto.touch('lieux');
    await vi.advanceTimersByTimeAsync(1000);
    expect(last()).toEqual({ kind: 'problem', zone: 'lieux', text: 'Seul un parent peut enregistrer' });
  });

  it('rien à enregistrer (choix incomplet) : aucun message', async () => {
    const auto = createAutoSave({ save: async () => false, onState: (s) => states.push(s) });
    auto.touch('choix');
    await vi.advanceTimersByTimeAsync(1000);
    expect(last()).toEqual({ kind: 'idle' });
  });

  it('modifié pendant l’enregistrement : reste « en attente », puis enregistre à nouveau', async () => {
    let finish!: (v: boolean) => void;
    const save = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const auto = createAutoSave({ save, onState: (s) => states.push(s), delayMs: 800 });
    auto.touch('matin');
    await vi.advanceTimersByTimeAsync(800);
    expect(last()).toEqual({ kind: 'saving', zone: 'matin' });
    auto.touch('matin');
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual({ kind: 'pending', zone: 'matin' });
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(2);
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual({ kind: 'saved', zone: 'matin' });
  });

  it('flush enregistre tout de suite ce qui attend ; cancel abandonne', async () => {
    const save = vi.fn(async () => true);
    const auto = createAutoSave({ save, onState: (s) => states.push(s) });
    auto.touch('matin');
    await auto.flush();
    expect(save).toHaveBeenCalledTimes(1);
    auto.touch('matin');
    auto.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('warn affiche un avertissement sans enregistrer', () => {
    const save = vi.fn(async () => true);
    const auto = createAutoSave({ save, onState: (s) => states.push(s) });
    auto.warn('arrets', '4 arrêts au plus');
    expect(last()).toEqual({ kind: 'problem', zone: 'arrets', text: '4 arrêts au plus' });
    expect(save).not.toHaveBeenCalled();
  });
});

describe('requireParent', () => {
  const actor = (allowed: boolean, kiosk: boolean, parent: boolean | null) => ({
    allow: async () => allowed,
    isKiosk: async () => kiosk,
    current: parent === null ? null : { parent },
  });

  it('un parent reconnu sur la tablette, ou un téléphone : passe', async () => {
    await expect(requireParent(actor(true, true, true), 'refus')).resolves.toBeUndefined();
    await expect(requireParent(actor(true, false, null), 'refus')).resolves.toBeUndefined();
  });

  it('un enfant sur la tablette : refus affiché', async () => {
    await expect(requireParent(actor(true, true, false), 'Seul un parent peut modifier')).rejects.toThrow('Seul un parent peut modifier');
  });

  it('personne de reconnu : invite à regarder la tablette', async () => {
    await expect(requireParent(actor(false, true, null), 'refus')).rejects.toThrow('regarde la tablette');
  });
});
