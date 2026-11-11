// Tests du découpage d'une recette copiée en texte : pages inventées (fixtures/), bruit d'une page entière, titres de
// section usuels, portions et temps, étapes numérotées de plusieurs façons, sections parasites.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { durationMinutes, looksLikeRecipeText, parseRecipeText } from './recipe-text.ts';

const ids = () => {
  let n = 0;
  return () => `t${++n}`;
};
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const parse = (text: string, title?: string) => parseRecipeText(text, { nextId: ids(), title });

describe('parseRecipeText : page entière copiée', () => {
  const { content, url } = parse(fixture('recette-copiee-bruitee.txt'));

  it('trouve le titre avant les ingrédients, sans le menu, les notes ni l’introduction', () => {
    expect(content.title).toBe('Gratin de courgettes au chèvre');
  });

  it('lit les portions (« 4 » puis « personnes ») et les temps sur deux lignes', () => {
    expect(content.servings).toBe(4);
    expect(content.servingsUnit).toBeNull();
    expect([content.prepMinutes, content.cookMinutes, content.totalMinutes]).toEqual([20, 35, 55]);
  });

  it('analyse les ingrédients avec leurs groupes, recolle « 2 » et « œufs », ignore ustensiles et publicité', () => {
    expect(content.ingredients.map((l) => [l.name, l.quantity, l.unit, l.section])).toEqual([
      ['courgette', 3, 'piece', 'Pour les légumes'],
      ['oignon', 2, 'piece', 'Pour les légumes'],
      ['ail', 1, 'gousse', 'Pour les légumes'],
      ['crème fraîche', 20, 'cl', 'Pour la sauce'],
      ['œuf', 2, 'piece', 'Pour la sauce'],
      ['fromage de chèvre frais', 150, 'g', 'Pour la sauce'],
      ['gruyère', 50, 'g', 'Pour la sauce'],
      ['sel', null, null, 'Pour la sauce'],
      ['poivre', null, null, 'Pour la sauce'],
    ]);
  });

  it('regroupe le texte de chaque « Étape N » et s’arrête avant « Vous aimerez aussi »', () => {
    expect(content.steps.map((s) => s.text)).toEqual([
      'Préchauffer le four à 200 °C (th. 6-7).',
      'Laver les courgettes et les couper en rondelles. Les faire revenir 10 minutes à la poêle avec les oignons et l\'ail.',
      'Battre les œufs avec la crème, saler, poivrer.\nAjouter le chèvre émietté.',
      'Disposer les légumes dans le plat, verser la sauce, parsemer de gruyère et enfourner 35 minutes.',
    ]);
    expect(content.ingredients.some((l) => l.name.includes('poireau'))).toBe(false);
  });

  it('garde l’astuce et le lien de la page', () => {
    expect(content.tips).toBe('Une pincée de muscade dans la sauce relève joliment le tout.');
    expect(url).toBe('https://petit-fourneau.example/recettes/gratin-courgettes-chevre');
    expect(content.appliance).toBeNull();
  });
});

describe('parseRecipeText : mode lecture', () => {
  const { content, url } = parse(fixture('recette-mode-lecture.txt'));

  it('lit titre, portions, temps et étapes numérotées « 1. »', () => {
    expect(content.title).toBe('Tarte aux pommes de Sam');
    expect(content.servings).toBe(6);
    expect([content.prepMinutes, content.cookMinutes, content.totalMinutes]).toEqual([25, 60, 85]);
    expect(content.ingredients.map((l) => l.text)).toEqual(['1 pâte brisée', '6 pommes', '3 cuillères à soupe de sucre', '1 sachet de sucre vanillé', '30 g de beurre']);
    expect(content.ingredients[2]).toMatchObject({ quantity: 3, unit: 'cs', name: 'sucre' });
    expect(content.steps).toHaveLength(3);
    expect(content.steps[0].text).toBe('Étaler la pâte dans un moule et la piquer avec une fourchette.');
    expect(url).toBeNull();
  });
});

describe('parseRecipeText : variantes', () => {
  it('sans titre « Préparation » : la première phrase ouvre les étapes', () => {
    const { content } = parse(['Crêpes du dimanche', 'Ingrédients', '250 g de farine', '4 œufs', '50 cl de lait', 'Mélanger la farine et les œufs, puis ajouter le lait petit à petit.', 'Laisser reposer une heure.'].join('\n'));
    expect(content.ingredients).toHaveLength(3);
    expect(content.steps.map((s) => s.text)).toEqual(['Mélanger la farine et les œufs, puis ajouter le lait petit à petit.', 'Laisser reposer une heure.']);
  });

  it('sans titre « Ingrédients » : une suite de quantités suffit', () => {
    const { content } = parse(['Soupe express', '1 poireau', '2 pommes de terre', '1 l de bouillon', 'Étapes', 'Tout couper et cuire 20 minutes.'].join('\n'));
    expect(content.title).toBe('Soupe express');
    expect(content.ingredients.map((l) => l.name)).toEqual(['poireau', 'pomme de terre', 'bouillon']);
    expect(content.steps).toHaveLength(1);
  });

  it('un menu « Ingrédients » sans quantités ne trompe pas le début de la recette', () => {
    const { content } = parse(['Ingrédients', 'Saisons', 'Pain perdu', 'Ingrédients pour 2 personnes', '2 tranches de pain', '1 œuf', '10 cl de lait', 'Préparation', 'Tremper le pain et le dorer à la poêle.'].join('\n'));
    expect(content.title).toBe('Pain perdu');
    expect(content.servings).toBe(2);
    expect(content.ingredients).toHaveLength(3);
  });

  it('« Pour 12 crêpes » : des portions qui ne sont pas des personnes', () => {
    const { content } = parse(['Crêpes', 'Pour 12 crêpes', 'Ingrédients', '250 g de farine', '3 œufs'].join('\n'));
    expect([content.servings, content.servingsUnit]).toEqual([12, 'crêpes']);
  });

  it('étapes : numéro seul sur sa ligne, puis le texte', () => {
    const { content } = parse(['Riz cantonais', 'Ingrédients', '200 g de riz', '2 œufs', 'Préparation', '1', 'Cuire le riz.', '2', 'Faire une omelette', 'et la couper en lanières.'].join('\n'));
    expect(content.steps.map((s) => s.text)).toEqual(['Cuire le riz.', 'Faire une omelette\net la couper en lanières.']);
  });

  it('« Étape 2 : cuisson » garde le texte de la ligne', () => {
    const { content } = parse(['Poulet', 'Ingrédients', '1 poulet', '2 oignons', 'Étape 1 : Découper le poulet.', 'Étape 2 : cuisson', 'Cuire 35 minutes en mode sous pression.'].join('\n'));
    expect(content.steps.map((s) => s.text)).toEqual(['Découper le poulet.', 'cuisson\nCuire 35 minutes en mode sous pression.']);
  });

  it('repère une recette Cookeo et retire « Recette de » du titre', () => {
    const { content } = parse(['Recette de poulet basquaise au Cookeo', 'Ingrédients', '4 cuisses de poulet', '2 poivrons', 'Préparation', 'Lancer le mode dorer.'].join('\n'));
    expect(content.title).toBe('Poulet basquaise au Cookeo');
    expect(content.appliance).toBe('cookeo');
  });

  it('prend le titre partagé quand le texte n’en a pas, sans le nom du site', () => {
    const { content } = parse(['Ingrédients', '2 œufs', '1 pincée de sel', 'Préparation', 'Battre et cuire.'].join('\n'), 'Omelette nature - Le Petit Fourneau');
    expect(content.title).toBe('Omelette nature');
  });

  it('s’arrête aux commentaires et au pied de page', () => {
    const { content } = parse(['Salade', 'Ingrédients', '1 salade', '2 tomates', 'Préparation', 'Tout mélanger.', '3 commentaires', 'Super recette, merci beaucoup pour le partage !'].join('\n'));
    expect(content.steps.map((s) => s.text)).toEqual(['Tout mélanger.']);
  });

  it('un texte vide ou sans recette ne plante pas', () => {
    expect(parse('').content).toMatchObject({ title: 'Recette', ingredients: [], steps: [] });
    expect(parse('Acheter du pain\nAppeler Alex').content.ingredients).toEqual([]);
  });

  it('tient un texte énorme (coupé à la limite)', () => {
    const big = `Gâteau\nIngrédients\n200 g de farine\n2 œufs\n${'bla '.repeat(100_000)}`;
    expect(parse(big).content.ingredients.length).toBeGreaterThanOrEqual(2);
  });
});

describe('durationMinutes', () => {
  it.each([
    ['15 min', 15],
    ['1 h 15', 75],
    ['1h30', 90],
    ['2 heures', 120],
    ['45 minutes', 45],
    ['20 mn', 20],
    ['bientôt', null],
  ])('%s → %s', (text, minutes) => expect(durationMinutes(text)).toBe(minutes));
});

describe('looksLikeRecipeText', () => {
  it('une recette copiée, oui ; une note pour la liste, non', () => {
    expect(looksLikeRecipeText(fixture('recette-mode-lecture.txt'))).toBe(true);
    expect(looksLikeRecipeText('Du lait\ndu pain')).toBe(false);
    expect(looksLikeRecipeText('Penser à appeler Sam\nRendez-vous dentiste\nAcheter des timbres\nRanger le garage')).toBe(false);
  });
});
