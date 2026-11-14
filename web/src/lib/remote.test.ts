// Tests de la télécommande du téléphone : boutons permis selon l'état et le moyen d'action de la télé, textes d'état,
// file des touches qui regroupe une rafale, compte rendu qui s'efface seul.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteKey } from '../../../shared/screen.ts';
import { appsDate, capabilities, controlHint, createFeedbackTimer, createKeyQueue, FEEDBACK_MS, statusLine } from './remote.ts';

describe('télécommande : état de la télé', () => {
  it('ligne d’état', () => {
    expect(statusLine({ name: 'Télé du salon', power: 'on' })).toBe('Télé du salon · allumée');
    expect(statusLine({ name: 'Télé du salon', power: 'standby' })).toBe('Télé du salon · en veille');
    expect(statusLine({ name: 'Télé du salon', power: 'offline' })).toBe('Télé du salon · injoignable');
  });

  it('boutons permis selon le moyen d’action de l’appli', () => {
    expect(capabilities({ power: 'on', control: 'adb' })).toEqual({ keys: true, basic: true, apps: true });
    expect(capabilities({ power: 'standby', control: 'adb' })).toEqual({ keys: true, basic: true, apps: true });
    expect(capabilities({ power: 'on', control: 'accessibility' })).toEqual({ keys: false, basic: true, apps: true });
    expect(capabilities({ power: 'on', control: 'authorize' })).toEqual({ keys: false, basic: true, apps: true });
    expect(capabilities({ power: 'on', control: null })).toEqual({ keys: false, basic: false, apps: false });
    expect(capabilities({ power: 'offline', control: 'adb' })).toEqual({ keys: false, basic: false, apps: false });
  });

  it('explication quand une partie manque', () => {
    expect(controlHint({ power: 'on', control: 'adb', canWake: true })).toBeNull();
    expect(controlHint({ power: 'offline', control: null, canWake: true })).toContain('par Cast');
    expect(controlHint({ power: 'offline', control: null, canWake: false })).toContain('ne répond pas');
    expect(controlHint({ power: 'on', control: 'authorize', canWake: false })).toContain('Autoriser le débogage');
    expect(controlHint({ power: 'on', control: null, canWake: false })).toContain('trop ancienne');
  });

  it('date de la liste des applis', () => {
    const now = new Date(2026, 10, 14, 20, 0);
    expect(appsDate(new Date(2026, 10, 14, 18, 5).toISOString(), now)).toBe('Liste reçue de la télé il y a 1 h');
    expect(appsDate(null, now)).toBeNull();
  });
});

describe('télécommande : file des touches', () => {
  it('une rafale pendant un envoi part en un seul envoi suivant', async () => {
    const sent: RemoteKey[][] = [];
    let release: () => void = () => {};
    const queue = createKeyQueue(
      (keys) => {
        sent.push(keys);
        return new Promise<void>((resolve) => (release = resolve));
      },
      () => {},
    );
    queue.press('down');
    queue.press('down');
    queue.press('right');
    queue.press('ok');
    expect(sent).toEqual([['down']]);
    expect(queue.waiting).toBe(3);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([['down'], ['down', 'right', 'ok']]);
    release();
    await new Promise((r) => setTimeout(r, 0));
    queue.press('back');
    expect(sent.at(-1)).toEqual(['back']);
  });

  it('un envoi raté est signalé, les suivants partent quand même', async () => {
    const errors: string[] = [];
    const sent: RemoteKey[][] = [];
    const queue = createKeyQueue(
      async (keys) => {
        sent.push(keys);
        if (keys[0] === 'up') throw new Error('Touches indisponibles');
      },
      (message) => errors.push(message),
    );
    queue.press('up');
    queue.press('down');
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toEqual(['Touches indisponibles']);
    expect(sent).toEqual([['up'], ['down']]);
  });
});

describe('télécommande : compte rendu', () => {
  afterEach(() => vi.useRealTimers());

  it('une réussite s’efface après 3 s, une erreur après 6 s', () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const feedback = createFeedbackTimer(dismiss);
    feedback.show('notice');
    vi.advanceTimersByTime(FEEDBACK_MS.notice - 1);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledTimes(1);

    feedback.show('error');
    vi.advanceTimersByTime(FEEDBACK_MS.notice);
    expect(dismiss).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FEEDBACK_MS.error - FEEDBACK_MS.notice);
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it('un nouveau message relance le compte à rebours, stop l’annule', () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const feedback = createFeedbackTimer(dismiss);
    feedback.show('notice');
    vi.advanceTimersByTime(2_000);
    feedback.show('notice');
    vi.advanceTimersByTime(2_000);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(dismiss).toHaveBeenCalledTimes(1);

    feedback.show('error');
    feedback.stop();
    vi.advanceTimersByTime(FEEDBACK_MS.error);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
