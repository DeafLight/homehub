// Tests de l'annuaire des membres : il suit la configuration rechargée à chaud.
import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';

describe('createHousehold', () => {
  it('membres, profils (famille comprise) et noms affichés', () => {
    const config = createConfigStore(
      parseConfig({ members: [{ id: 'sam', name: 'Sam', color: '#5b8def', parent: true }], family: { name: 'Les Martin' } }),
    );
    const household = createHousehold(config);
    expect(household.member('sam')?.parent).toBe(true);
    expect(household.member(null)).toBeUndefined();
    expect(household.isMember('famille')).toBe(false);
    expect(household.ownerIds()).toEqual(['sam', 'famille']);
    expect(household.isOwner('famille')).toBe(true);
    expect(household.nameOf('famille')).toBe('Les Martin');
    expect(household.nameOf('inconnu')).toBe('inconnu');

    config.set(parseConfig({ members: [{ id: 'lea', name: 'Léa', color: '#3fb8a8' }] }));
    expect(household.ownerIds()).toEqual(['lea', 'famille']);
    expect(household.nameOf('lea')).toBe('Léa');
  });
});
