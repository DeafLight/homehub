// Tests de la vue cuisine de la télé : étape ramenée dans la recette, durées citées et minuteur déjà lancé pour elles,
// mode Cookeo, étape suivante abrégée, minuteurs de la maison décomptés à l'heure du serveur et rattachés à leur étape.
import { describe, expect, it } from 'vitest';
import type { Recipe, RecipeContent } from './recipes.ts';
import { timerLabel } from './recipes.ts';
import { clampStep, screenCookView, shorten, timerStep } from './screen-cook.ts';
import type { Timer } from './types.ts';

const NOW = new Date('2026-11-05T18:30:00Z');

function recipe(steps: string[], appliance: RecipeContent['appliance'] = null, title = 'Mijoté de lentilles'): Recipe {
  const ours: RecipeContent = {
    title,
    servings: 4,
    servingsUnit: null,
    ingredients: [],
    steps: steps.map((text, i) => ({ id: `s${i}`, text, section: i < 1 ? 'Préparation' : null })),
    tips: '',
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    appliance,
  };
  return { id: 'r1', ours, source: null } as unknown as Recipe;
}

const timer = (label: string, seconds: number, leftSeconds: number): Timer => ({
  id: `t-${label}-${seconds}`,
  label,
  durationSeconds: seconds,
  startedAt: new Date(NOW.getTime() - (seconds - leftSeconds) * 1000).toISOString(),
  endsAt: new Date(NOW.getTime() + leftSeconds * 1000).toISOString(),
  startedBy: { ownerId: 'alex', via: 'tablet' },
});

const STEPS = ['Émincer l’oignon et les carottes.', 'Faire revenir 5 minutes, puis ajouter les lentilles et cuire 25 minutes à feu doux.', 'Servir chaud.'];

describe('vue cuisine de la télé', () => {
  it('étape en cours, ses durées, la suivante', () => {
    const view = screenCookView(recipe(STEPS), { recipeId: 'r1', index: 1, rev: 3 }, [], NOW);
    expect(view).toMatchObject({ rev: 3, recipeId: 'r1', title: 'Mijoté de lentilles', index: 1, total: 3, next: 'Servir chaud.', timers: [] });
    expect(view.step).toEqual({
      number: 2,
      text: STEPS[1],
      section: null,
      mode: null,
      durations: [
        { seconds: 300, text: '5 min', timerId: null },
        { seconds: 1500, text: '25 min', timerId: null },
      ],
    });
  });

  it('première étape avec sa partie ; dernière sans suivante ; index hors recette ramené', () => {
    expect(screenCookView(recipe(STEPS), { recipeId: 'r1', index: 0, rev: 1 }, [], NOW).step?.section).toBe('Préparation');
    const last = screenCookView(recipe(STEPS), { recipeId: 'r1', index: 9, rev: 1 }, [], NOW);
    expect(last).toMatchObject({ index: 2, next: null });
    expect(last.step?.number).toBe(3);
  });

  it('recette sans étapes : rien à afficher', () => {
    expect(screenCookView(recipe([]), { recipeId: 'r1', index: 0, rev: 1 }, [], NOW)).toMatchObject({ index: 0, total: 0, step: null, next: null });
  });

  it('mode Cookeo de l’étape pour une recette Cookeo', () => {
    const view = screenCookView(recipe(['Cuire sous pression 10 minutes.'], 'cookeo'), { recipeId: 'r1', index: 0, rev: 1 }, [], NOW);
    expect(view.step?.mode).toBe('Sous pression');
  });

  it('minuteurs de la maison : temps restant, sonnerie, étape qui les a lancés, durée de l’étape déjà lancée', () => {
    const title = 'Mijoté de lentilles';
    const timers = [timer(timerLabel(title, 2), 1500, 61.2), timer(timerLabel(title, 1), 300, -4), timer('Écrans', 1800, 900)];
    const view = screenCookView(recipe(STEPS), { recipeId: 'r1', index: 1, rev: 1 }, timers, NOW);
    expect(view.timers.map(({ label, remainingSeconds, ended, step }) => ({ label, remainingSeconds, ended, step }))).toEqual([
      { label: 'Cuisson · ét. 2 · Mijoté de l…', remainingSeconds: 62, ended: false, step: 2 },
      { label: 'Cuisson · ét. 1 · Mijoté de l…', remainingSeconds: 0, ended: true, step: 1 },
      { label: 'Écrans', remainingSeconds: 900, ended: false, step: null },
    ]);
    expect(view.step?.durations.map((d) => d.timerId)).toEqual([null, timers[0].id]);
  });
});

describe('outils de la vue cuisine', () => {
  it('minuteur d’une autre recette ou d’une étape qui n’existe pas : pas rattaché', () => {
    expect(timerStep({ label: timerLabel('Galettes', 2) }, 'Mijoté de lentilles', 3)).toBeNull();
    expect(timerStep({ label: timerLabel('Mijoté de lentilles', 7) }, 'Mijoté de lentilles', 3)).toBeNull();
    const long = 'Mijoté de lentilles aux carottes et au cumin';
    expect(timerStep({ label: timerLabel(long, 3) }, long, 3)).toBe(3);
  });

  it('étape ramenée entre la première et la dernière', () => {
    expect(clampStep(-2, 5)).toBe(0);
    expect(clampStep(7, 5)).toBe(4);
    expect(clampStep(2, 0)).toBe(0);
  });

  it('texte abrégé au mot', () => {
    expect(shorten('  Servir   chaud. ', 20)).toBe('Servir chaud.');
    expect(shorten('Ajouter les lentilles et cuire à feu doux', 20)).toBe('Ajouter les…');
  });
});
