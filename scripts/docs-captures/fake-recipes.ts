// Faux site de recettes du monde fictif (cuisine.exemple.test) : des recettes inventées pour les captures, publiées
// comme sur les vrais sites (schema.org Recipe en JSON-LD), avec une photo dessinée ici (une assiette vue de dessus).
// Aucune vraie recette : le dépôt est public et les recettes des sites ont leurs auteurs.
import { PNG } from 'pngjs';

export const RECIPE_HOST = 'cuisine.exemple.test';
const BASE = `https://${RECIPE_HOST}`;

type FakeRecipe = {
  slug: string;
  name: string;
  yield: unknown;
  times: { prepTime?: string; cookTime?: string; totalTime?: string };
  ingredients: string[];
  steps: (string | { section: string; steps: string[] })[];
  /** Couleurs de la photo : fond, garniture. */
  colors: [number, number, number][];
  keywords?: string;
};

const RECIPES: FakeRecipe[] = [
  {
    slug: 'mijote-lentilles-cookeo',
    name: 'Mijoté de lentilles aux carottes au Cookeo',
    yield: 4,
    times: { totalTime: 'PT40M' },
    ingredients: ['300g Lentilles vertes', '3 Carottes', '1 Oignon', '2 gousses d’ail', '1 Cube de bouillon de légumes', '75cl Eau', '1 c. à s. d’huile d’olive', 'Sel, poivre'],
    steps: [
      { section: 'Préparation', steps: ['Éplucher et émincer l’oignon et l’ail.\nCouper les carottes en rondelles.'] },
      {
        section: 'Cuisson',
        steps: [
          'Verser l’huile dans la cuve, lancer le mode dorer et faire revenir l’oignon et l’ail 3 minutes.',
          'Ajouter les lentilles rincées, les carottes, le cube de bouillon émietté et l’eau.',
          'Fermer le couvercle et cuire en mode sous pression 15 minutes.',
          'Ouvrir, saler, poivrer et laisser reposer 5 minutes avant de servir.',
        ],
      },
    ],
    colors: [[120, 84, 52], [222, 128, 46]],
    keywords: 'cookeo, lentilles, végétarien',
  },
  {
    slug: 'galettes-sarrasin',
    name: 'Galettes de sarrasin du dimanche',
    yield: '12 galettes',
    times: { prepTime: 'PT15M', cookTime: 'PT30M', totalTime: 'PT45M' },
    ingredients: ['250 g de farine de sarrasin', '1 œuf', '50 cl d’eau froide', '1 pincée de gros sel', 'Beurre pour la poêle'],
    steps: [
      'Mélanger la farine et le sel dans un grand saladier.',
      'Ajouter l’œuf, puis l’eau petit à petit en fouettant jusqu’à une pâte lisse.',
      'Laisser reposer la pâte 1 h au réfrigérateur.',
      'Beurrer une grande poêle bien chaude, verser une louche de pâte et cuire 2 minutes de chaque côté.',
    ],
    colors: [[92, 64, 44], [196, 150, 92]],
  },
  {
    slug: 'riz-saute-legumes',
    name: 'Riz sauté aux légumes',
    yield: ['1', 'portion'],
    times: { prepTime: 'PT5M', cookTime: 'PT12M', totalTime: 'PT17M' },
    ingredients: ['70 g Riz', '1   Carotte', '50 g Petits pois', '1/4 càc Curry (poudre)', '1 càs Sauce soja', 'facultatif 1 càc Graines de sésame'],
    steps: ['Cuire le riz 10 minutes dans l’eau bouillante, puis l’égoutter.', 'Faire sauter la carotte râpée et les petits pois 2 min, ajouter le riz, le curry et la sauce soja.'],
    colors: [[44, 58, 50], [236, 214, 150]],
  },
];

const jsonLd = (r: FakeRecipe) => ({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Cuisine d’exemple' },
    {
      '@type': 'Recipe',
      name: r.name,
      image: [`${BASE}/photos/${r.slug}.png`],
      recipeYield: r.yield,
      ...r.times,
      ...(r.keywords && { keywords: r.keywords }),
      recipeIngredient: r.ingredients,
      recipeInstructions: r.steps.map((s) =>
        typeof s === 'string'
          ? { '@type': 'HowToStep', text: s }
          : { '@type': 'HowToSection', name: s.section, itemListElement: s.steps.map((text) => ({ '@type': 'HowToStep', text })) },
      ),
    },
  ],
});

const page = (title: string, head: string) =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><meta property="og:site_name" content="Cuisine d’exemple">${head}</head><body><h1>${title}</h1></body></html>`;

/** Photo d'une assiette vue de dessus : table, assiette claire, garniture, quelques touches de couleur. */
function photo([table, food]: [number, number, number][], seed: number): Buffer {
  const w = 640;
  const h = 420;
  const png = new PNG({ width: w, height: h });
  const random = (n: number) => {
    const x = Math.sin(seed * 97 + n * 13.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const dots = Array.from({ length: 26 }, (_, i) => ({ x: 320 + (random(i) - 0.5) * 220, y: 210 + (random(i + 50) - 0.5) * 200, r: 6 + random(i + 99) * 10 }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 320, y - 210);
      let c = table.map((v) => v * (0.9 + 0.1 * Math.sin(y / 9))) as number[];
      if (d < 190) c = [236, 232, 224];
      if (d < 172) c = [246, 243, 236];
      if (d < 130) c = food.map((v, i) => v * (0.85 + 0.15 * random(Math.floor(x / 7) + Math.floor(y / 7) * 91 + i)));
      for (const dot of dots) if (d < 130 && Math.hypot(x - dot.x, y - dot.y) < dot.r) c = [74, 140, 66];
      const i = (y * w + x) * 4;
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export const recipeUrl = (slug: string) => `${BASE}/recettes/${slug}`;
export const FAKE_RECIPE_SLUGS = RECIPES.map((r) => r.slug);
/** Page d'un blog sans données de recette : l'import propose la saisie à la main. */
export const BLOG_URL = `${BASE}/blog/souvenirs-de-cuisine`;

/** Réponse du faux site pour une adresse de cuisine.exemple.test. */
export function fakeRecipeSite(url: URL): Response {
  const photoMatch = /^\/photos\/(.+)\.png$/u.exec(url.pathname);
  if (photoMatch) {
    const index = RECIPES.findIndex((r) => r.slug === photoMatch[1]);
    if (index === -1) return new Response('', { status: 404 });
    return new Response(new Uint8Array(photo(RECIPES[index].colors, index + 1)), { headers: { 'content-type': 'image/png' } });
  }
  if (url.pathname === new URL(BLOG_URL).pathname) return new Response(page('Souvenirs de cuisine', ''), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const recipe = RECIPES.find((r) => url.pathname === `/recettes/${r.slug}`);
  if (!recipe) return new Response('', { status: 404 });
  const html = page(recipe.name, `<script type="application/ld+json">${JSON.stringify(jsonLd(recipe))}</script>`);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
