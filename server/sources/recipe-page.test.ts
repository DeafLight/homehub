// Tests du lecteur de pages de recettes, sur des pages inventées (fixtures/recettes) qui reprennent les formes
// rencontrées : @graph, JSON-LD au premier niveau avec portions à 1, multicuiseur avec sections, microdata.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeEntities, decodePage, htmlText, readRecipePage, siteName } from './recipe-page.ts';

const page = (name: string) => readFileSync(new URL(`./fixtures/recettes/${name}`, import.meta.url), 'utf8');
const ids = () => {
  let n = 0;
  return () => `r${++n}`;
};
const read = (name: string, url = 'https://cuisine.exemple.test/recettes/1') => readRecipePage(page(name), url, ids());

describe('readRecipePage', () => {
  it('JSON-LD dans un @graph : titre, portions non personnes, temps, étapes, photo relative', () => {
    const result = read('graphe.html');
    if (!result.found) throw new Error('recette attendue');
    const { content, imageUrl, site } = result;
    expect(site).toBe("Cuisine d'exemple");
    expect(imageUrl).toBe('https://cuisine.exemple.test/photos/galettes.jpg');
    expect(content).toMatchObject({ title: 'Galettes du dimanche', servings: 12, servingsUnit: 'galettes', prepMinutes: 15, cookMinutes: 20, totalMinutes: 35, appliance: null, tips: '' });
    expect(content.ingredients.map((i) => i.text)).toEqual(['250 g de farine de sarrasin', '2 œufs', "50 cl d'eau", '1 pincée de sel', 'Beurre pour la poêle']);
    expect(content.ingredients.map((i) => [i.quantity, i.unit, i.key])).toEqual([
      [250, 'g', 'farine-de-sarrasin'],
      [2, 'piece', 'oeuf'],
      [50, 'cl', 'eau'],
      [1, 'pincee', 'sel'],
      [null, null, 'beurre'],
    ]);
    expect(content.steps).toHaveLength(4);
    expect(content.steps[2]).toEqual({ id: expect.any(String), text: 'Laisser reposer la pâte 1 h au frais.', section: null });
  });

  it('quantités pour une portion, abréviations, facultatif, ImageObject', () => {
    const result = read('portion.html', 'https://www.jow.fr/recipes/riz');
    if (!result.found) throw new Error('recette attendue');
    expect(result.site).toBe('Jow');
    expect(result.imageUrl).toBe('https://img.exemple.test/riz.png');
    expect(result.content.servings).toBe(1);
    expect(result.content.ingredients.map((i) => [i.quantity, i.unit, i.name, i.optional])).toEqual([
      [70, 'g', 'riz', false],
      [1, 'piece', 'carotte', false],
      [0.25, 'cc', 'curry', false],
      [1, 'cs', 'sauce soja', false],
      [1, 'cc', 'graine de sésame', true],
    ]);
  });

  it('multicuiseur : sections d’étapes, unités collées, temps total seul, Cookeo repéré', () => {
    const result = read('cookeo.html', 'https://www.moulinex.fr/recette/detail/1');
    if (!result.found) throw new Error('recette attendue');
    const { content } = result;
    expect(result.site).toBe('Moulinex');
    expect(content).toMatchObject({ servings: 4, servingsUnit: null, prepMinutes: null, cookMinutes: null, totalMinutes: 45, appliance: 'cookeo' });
    expect(content.steps.map((s) => [s.section, s.text])).toEqual([
      ['Préparation', "Éplucher et émincer l'oignon.\nCouper les carottes en rondelles."],
      ['Cuisson', "Faire revenir l'oignon en mode dorer 3 minutes."],
      ['Cuisson', 'Ajouter le reste dans la cuve, puis cuire en mode sous pression 15 minutes.'],
    ]);
    // « Sel, poivre » : deux ingrédients, la ligne d'origine gardée
    expect(content.ingredients.slice(-2).map((i) => [i.key, i.text])).toEqual([['sel', 'Sel, poivre'], ['poivre', 'Sel, poivre']]);
    expect(content.ingredients[0]).toMatchObject({ quantity: 300, unit: 'g', name: 'lentille verte' });
  });

  it('microdata, à défaut de JSON-LD', () => {
    const result = read('microdata.html');
    if (!result.found) throw new Error('recette attendue');
    expect(result.imageUrl).toBe('https://cuisine.exemple.test/img/soupe.jpg');
    expect(result.content).toMatchObject({ title: 'Soupe de potiron', servings: 6, totalMinutes: 40 });
    expect(result.content.ingredients.map((i) => i.text)).toEqual(['1 kg de potiron', '2 pommes de terre', '20 cl de crème']);
    expect(result.content.steps.map((s) => s.text)).toEqual(['Couper les légumes en morceaux.', 'Cuire 30 minutes puis mixer avec la crème.']);
  });

  it('sans recette : le titre de la page, pour la saisie à la main', () => {
    const html = '<html><head><meta property="og:title" content="Mon blog &amp; ses gâteaux"></head><body>Rien</body></html>';
    expect(readRecipePage(html, 'https://blog.exemple.test/', ids())).toEqual({ found: false, title: 'Mon blog & ses gâteaux', site: 'blog.exemple.test' });
  });

  it('un bloc JSON-LD illisible n’empêche pas de lire le suivant', () => {
    const html = `<script type="application/ld+json">{"@type": "Recipe",}</script>
      <script type="application/ld+json">{"@type":["Recipe","NewsArticle"],"name":"Tarte","recipeIngredient":["1 pâte brisée"],"recipeInstructions":"Étaler la pâte.\\nCuire 25 min."}</script>`;
    const result = readRecipePage(html, 'https://exemple.test/tarte', ids());
    if (!result.found) throw new Error('recette attendue');
    expect(result.content.steps.map((s) => s.text)).toEqual(['Étaler la pâte.', 'Cuire 25 min.']);
  });

  it('une recette sans ingrédients ni étapes ne compte pas', () => {
    const html = '<script type="application/ld+json">{"@type":"Recipe","name":"Vide"}</script>';
    expect(readRecipePage(html, 'https://exemple.test/', ids())).toMatchObject({ found: false, title: 'Vide' });
  });
});

describe('outils', () => {
  it('decodeEntities et htmlText', () => {
    expect(decodeEntities('cr&egrave;me &amp; &#39;sel&#x2019; &frac12;')).toBe('crème & \'sel’ ½');
    expect(htmlText('<p>Un</p><p>Deux <b>gras</b></p><br>Trois')).toBe('Un\nDeux gras\nTrois');
  });

  it('siteName', () => {
    expect(siteName('https://www.marmiton.org/recettes/x')).toBe('Marmiton');
    expect(siteName('https://m.750g.com/x')).toBe('750g');
    expect(siteName('https://www.blog.exemple.test/x')).toBe('blog.exemple.test');
  });

  it('decodePage suit le jeu de caractères annoncé', () => {
    const latin1 = Buffer.from('<meta charset="iso-8859-1"><p>crème brûlée</p>', 'latin1');
    expect(decodePage(latin1, 'text/html')).toContain('crème brûlée');
    expect(decodePage(Buffer.from('crème', 'utf8'), 'text/html; charset=UTF-8')).toBe('crème');
  });
});
