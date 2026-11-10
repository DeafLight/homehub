// Tests des codes PIN exigés par la tablette : rien à vérifier sans PIN défini, refus, blocage après trop d'essais.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpError } from './http.ts';
import { createPinGate } from './pin-gate.ts';
import { createPinStore, MAX_PIN_FAILURES, PARENT_PIN_ID } from './sources/pins.ts';
import { fixedClock } from './testing.ts';

function setup() {
  const pins = createPinStore({ path: join(mkdtempSync(join(tmpdir(), 'homehub-pins-')), 'pins.json'), clock: fixedClock });
  return { pins, gate: createPinGate(pins) };
}

/** Statut et message du refus levé, ou 'ok'. */
const outcome = (promise: Promise<void>) =>
  promise.then(
    () => 'ok',
    (err: HttpError) => `${err.status} ${err.message}`,
  );

describe('createPinGate', () => {
  it('sans PIN défini, rien à vérifier', async () => {
    const { gate } = setup();
    expect(await outcome(gate.owner('lea', undefined))).toBe('ok');
    expect(await outcome(gate.ownerOrParent('lea', undefined))).toBe('ok');
    expect(await gate.protection()).toEqual({ protected: [], parent: false });
  });

  it('PIN du profil : requis, juste ou faux ; le code parent passe aussi pour retirer un téléphone', async () => {
    const { pins, gate } = setup();
    await pins.set('lea', '1234');
    await pins.set(PARENT_PIN_ID, '9999');
    expect(await gate.protection()).toEqual({ protected: ['lea'], parent: true });
    expect(await outcome(gate.owner('lea', undefined))).toBe('403 Code PIN requis');
    expect(await outcome(gate.owner('lea', '0000'))).toBe('403 Code PIN incorrect');
    expect(await outcome(gate.owner('lea', '1234'))).toBe('ok');
    expect(await outcome(gate.owner('lea', '9999'))).toBe('403 Code PIN incorrect');
    expect(await outcome(gate.ownerOrParent('lea', '9999'))).toBe('ok');
  });

  it('bloque après trop d’essais (429)', async () => {
    const { pins, gate } = setup();
    await pins.set('tom', '1234');
    for (let i = 0; i < MAX_PIN_FAILURES - 1; i++) await outcome(gate.owner('tom', '0000'));
    expect(await outcome(gate.owner('tom', '0000'))).toBe('429 Trop d’essais : réessaie dans 15 min');
    expect(await outcome(gate.owner('tom', '1234'))).toBe('429 Trop d’essais : réessaie dans 15 min');
  });

  it('code parent : doit d’abord être défini', async () => {
    const { pins, gate } = setup();
    expect(await outcome(gate.parent('1234'))).toBe('403 Définis d’abord le code parent');
    await pins.set(PARENT_PIN_ID, '1234');
    expect(await outcome(gate.parent(undefined))).toBe('403 Code PIN requis');
    expect(await outcome(gate.parent('1234'))).toBe('ok');
  });
});
