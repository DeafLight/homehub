import { describe, expect, it } from 'vitest';
import { createReadGate } from './scan-gate.ts';

describe('garde du scanner', () => {
  it('compte un code une fois, tant que le produit reste devant la caméra', () => {
    const gate = createReadGate(900);
    expect(gate.frame([], 0)).toBeNull();
    expect(gate.frame(['A'], 100)).toBe('A');
    expect(gate.state).toBe('hold');
    // Le produit reste là, même s'il n'est pas lu à chaque image.
    expect(gate.frame(['A'], 400)).toBeNull();
    expect(gate.frame([], 900)).toBeNull();
    expect(gate.frame(['A'], 1200)).toBeNull();
    expect(gate.frame([], 2000)).toBeNull();
    expect(gate.state).toBe('hold');
  });

  it('retiré, le même code compte de nouveau (deux paquets identiques)', () => {
    const gate = createReadGate(900);
    gate.frame(['A'], 0);
    gate.frame([], 500);
    expect(gate.frame([], 950)).toBeNull();
    expect(gate.state).toBe('ready');
    expect(gate.frame(['A'], 1000)).toBe('A');
  });

  it('après une question, ce qui est devant la caméra doit d’abord être retiré', () => {
    const gate = createReadGate(900);
    gate.frame(['A'], 0);
    gate.frame([], 1000);
    gate.hold(5000);
    expect(gate.frame(['A'], 5100)).toBeNull();
    expect(gate.frame([], 6100)).toBeNull();
    expect(gate.frame(['B'], 6200)).toBe('B');
  });
});
