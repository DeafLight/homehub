// Tests du bouton « Sur la télé » : télé où la recette est en mode cuisine, libellé selon le nombre de télés, état du
// pilotage.
import { describe, expect, it } from 'vitest';
import type { ScreenCook, ScreenCookTarget } from '../../../shared/screen-cook.ts';
import { cookingOn, launchLabel, pilotText } from './screen-cook.ts';

const cook = (recipeId: string, index: number, total: number) => ({ recipeId, index, total }) as ScreenCook;
const target = (id: string, c: ScreenCook | null): ScreenCookTarget => ({ id, name: id === 'salon' ? 'Télé du salon' : 'Télé de la chambre', online: true, cook: c });

describe('« Sur la télé » de la fiche recette', () => {
  it('télé où la recette est en mode cuisine', () => {
    const list = [target('chambre', cook('autre', 0, 3)), target('salon', cook('r1', 1, 4))];
    expect(cookingOn(list, 'r1')?.id).toBe('salon');
    expect(cookingOn(list, 'r2')).toBeNull();
  });

  it('libellé selon le nombre de télés', () => {
    expect(launchLabel({ name: 'Télé du salon' }, 1)).toBe('Sur la télé');
    expect(launchLabel({ name: 'Télé du salon' }, 2)).toBe('Sur Télé du salon');
  });

  it('état du pilotage', () => {
    expect(pilotText(target('salon', cook('r1', 1, 4)))).toBe('Télé du salon · étape 2 / 4');
    expect(pilotText(target('salon', cook('r1', 0, 0)))).toBe('Télé du salon · sans étapes');
    expect(pilotText(target('salon', null))).toBe('Télé du salon');
  });
});
