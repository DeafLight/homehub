# Étude « Drive » : remplir le panier d'une enseigne depuis la liste de courses

Étude menée le 12 novembre 2026, avant tout code. Question : comment HomeHub peut **remplir le panier d'un drive** à
partir de sa liste de courses (menu de la semaine et produits hors recettes), jusqu'où il peut aller (créneau), et par
quel chemin. Le paiement est hors sujet : HomeHub n'y touchera jamais.

Enseignes retenues : **Courses U** en priorité, puis E.Leclerc Drive et Carrefour ; Intermarché et Auchan vus plus
rapidement. Méthode : recherches web et navigateur intégré, **en lecture seule** : pages publiques, `robots.txt`,
mentions légales et CGU, scripts chargés par la page d'accueil. Aucune connexion à un compte, rien ajouté à un panier,
aucun point d'entrée interne appelé, rien d'automatisé sur les sites.

Règles posées par l'utilisateur, qui cadrent tout ce qui suit :

- on ne contourne **aucune** protection anti-robots (ni faux navigateur, ni robot sur le NAS qui se ferait passer pour
  une personne, ni résolution de captcha), comme pour les recettes ;
- on préfère **le navigateur de la personne**, connectée à son propre compte, à un robot sur le NAS ;
- HomeHub ne stocke jamais le mot de passe d'une enseigne et ne paie jamais.

## 1. Ce qu'on a trouvé, enseigne par enseigne

### Courses U (Coopérative U : Super U, Hyper U, U Express)

| Point | Constat |
|---|---|
| API publique | Aucune. |
| Voie partenaire | Oui, mais réservée aux entreprises : les recettes du site sont fournies par **Mealz** (ex-Miam, recettes « commandables » en marque blanche ; drapeau `MIAM_ENABLED` et cartes `miamRecipeCard` dans la page des recettes). La configuration de la page expose aussi des points d'entrée `Cart-AddProductsPartner` et `Cart-SetProductsPartnerWeb` : un ajout groupé au panier existe pour les partenaires, non documenté et non ouvert au public. Jow cite Courses U parmi ses enseignes selon certaines sources, sans confirmation récente. |
| Affiliation | Programme Courses U chez Awin (règles d'affiliation, pas d'API panier). Les mentions légales interdisent de créer sur *son propre site Internet* un lien vers coursesu.com sans autorisation écrite ; HomeHub est privé (pas un site public), mais un lien profond reste à garder discret (ouvrir une fiche, pas plus). |
| Import de liste | Pas d'import depuis l'extérieur. Le site et l'appli ont leurs propres **listes** (« Ajouter le panier dans une liste », listes habituelles ajoutées au panier en un geste dans l'appli). |
| Pages publiques | Plateforme Salesforce Commerce Cloud. Fiche produit `/p/<nom>/<identifiant>.html` avec un JSON-LD `Product` : `mpn` = **identifiant Courses U** (ex. `4863121`), `sku` = **EAN-13**, nom avec contenance (« …, 400g »), marque, images. **Pas de prix sans magasin choisi.** Recherche par mot-clé et suggestions dans le site. |
| `robots.txt` | Fiches `/p/` autorisées ; recherche, panier, paiement, compte, `demandware.store` interdits aux robots. Robots d'entraînement de Meta bloqués. |
| CGU / mentions légales | Reproduction du site interdite hors usage privé ; « toute extraction ou tentative d'extraction, totale ou partielle » des bases de données est susceptible d'engager la responsabilité. Pas de clause explicite sur les extensions ou l'automatisation d'un compte personnel. |
| Anti-robots | Cloudflare devant le site ; limiteur de débit avec captcha (`RateLimiter`) et jetons CSRF dans les formulaires. |
| Créneaux | Choisis dans le parcours de commande, une fois connecté ; aucune voie officielle pour les lire ou les réserver de l'extérieur. |

### E.Leclerc Drive

| Point | Constat |
|---|---|
| API publique | Aucune. |
| Voie partenaire | **Jow** remplit un panier Leclerc Drive (partenariat cité par l'App Store de Jow et la plupart des sources) ; « Panier vocal » maison. Une extension Chrome tierce (« Cuisinette ») prétend remplir un panier Leclerc depuis des recettes : sans utilisateurs ni avis, non évaluée. |
| Pages publiques | Catalogue par magasin (le drive choisi fixe prix et disponibilité). |
| `robots.txt` | Très ouvert (`Allow: /`, seules quelques sections interdites). |
| CGU / mentions légales | Les plus claires des enseignes vues : la personne a un droit personnel de consultation et **peut extraire ou réutiliser une partie non substantielle du contenu à des fins exclusivement personnelles** ; extraction substantielle et usage commercial interdits. |
| Anti-robots | **DataDome** et **hCaptcha** chargés dès la page d'accueil : toute requête jugée automatique est bloquée ou soumise à un captcha. |
| Créneaux | Dans le parcours connecté. |

### Carrefour

| Point | Constat |
|---|---|
| Voie officielle | **Application Carrefour dans ChatGPT** (mars 2026) : on demande un panier en conversation, il est composé puis finalisé et payé sur carrefour.fr avec son compte. Assistant maison **Hopla** sur le site. Carrefour soutient le « Universal Commerce Protocol » de Google (agents IA ↔ distributeurs). Mealz fournit aussi ses recettes commandables. Aucune de ces voies n'est ouverte à une application tierce comme HomeHub. |
| `robots.txt` | Très court : seuls les choix de magasin et quelques sections interdits. |
| CGU | Usage du site limité à « obtenir des informations » ; « toute extraction ou réutilisation, totale ou partielle » des bases interdite sans autorisation expresse. |
| Anti-robots | **DataDome** et captcha. |

### Intermarché et Auchan (vus rapidement)

- **Intermarché** : `robots.txt` qui interdit `/api/`, la recherche et les pages magasin ; première visite servie en
  **HTTP 403** (défi anti-robots) avant d'afficher le site. Partenaire de Jow.
- **Auchan** : `robots.txt` détaillé (recherche, panier, compte interdits) ; partenaire de Jow.

### Ce que font les applis de recettes (Jow, Mealz)

Elles ont des **contrats** avec les enseignes : catalogue fourni, correspondance recette → produits faite chez elles,
ajout au panier par un point d'entrée partenaire, puis la personne finit dans l'appli de l'enseigne. Aucune n'offre
d'API pour qu'un tiers y envoie *sa* liste. Ce modèle n'est pas accessible à un projet familial, sauf à demander un
accès partenaire (piste écrite à Coopérative U, sans grand espoir).

## 2. Les chemins possibles

### (a) Voie officielle

Aucune enseigne n'offre d'API ou d'import de liste ouvert à un tiers. Ce qui existe :

- **Carrefour dans ChatGPT** : HomeHub pourrait proposer « Copier la liste pour l'assistant » (texte simple), à coller
  dans ChatGPT avec l'appli Carrefour, ou dans Hopla. Officiel et conforme, mais il faut un compte ChatGPT, la
  correspondance produit est faite par l'assistant (pas retenue par HomeHub) et seul Carrefour est concerné.
- **Accès partenaire** (Courses U, Leclerc) : à demander par écrit ; peu probable pour un particulier.

### (b) Le navigateur de la personne, connectée à son compte

Principe : HomeHub prépare un **panier à envoyer** (identifiants produits de l'enseigne et nombre de paquets) ; une
extension, sur le site de l'enseigne ouvert par la personne, ajoute ces produits **depuis sa session**, un par un, à un
rythme humain, et rend la main. HomeHub ne voit jamais le compte ni le mot de passe.

Ce qui est propre :

- l'action est **déclenchée par la personne**, sur **son** compte, pour **ses** courses, quelques dizaines de produits :
  c'est l'usage personnel que les CGU autorisent (explicite chez Leclerc), pas une extraction de base ;
- le site est lu comme la personne le lit (fiche ouverte, JSON-LD `Product`) ; on ne récupère que ce qui sert au
  panier (identifiant, EAN, contenance, prix affiché) ;
- **si un captcha ou un blocage apparaît, l'extension s'arrête** et le dit ; elle ne cherche jamais à le résoudre ni
  à l'éviter (pas de rotation, pas de faux en-têtes, pas d'accélération). La personne finit à la main.

Ce qui irait contre les CGU ou nos règles : extraire le catalogue (prix de tout un rayon, historique de prix de
l'enseigne), faire tourner l'extension sans la personne, l'exécuter depuis le NAS, ou appeler les points d'entrée
« partenaire » de Courses U sans accord.

Deux façons d'ajouter un produit, par ordre de préférence :

1. **Cliquer le bouton « Ajouter » de la fiche** (ou de la ligne de recherche) dans la page ouverte : c'est le geste
   de la personne, en plus rapide ; le plus défendable, mais dépend de la structure de la page (fragile).
2. Appeler, depuis la page et avec ses jetons, la même requête que ce bouton (`Cart-AddProduct` chez Courses U) :
   moins fragile, mais c'est un point d'entrée interne non documenté ; à ne faire qu'avec la même cadence et la même
   règle d'arrêt, et à abandonner au premier signe de refus.

Supports :

| Support | Faisable ? | Remarque |
|---|---|---|
| Chrome / Edge / Firefox sur ordinateur | **Oui** | Extension Manifest V3, installée hors boutique (mode développeur) ou publiée en non listée. |
| Firefox Android | **Oui** | Accepte les extensions publiées sur addons.mozilla.org (publication non listée possible). Bonne cible téléphone. |
| Chrome Android | Non | Pas d'extensions. |
| Safari iOS | Possible mais lourd | Extension Safari = appli à publier sur l'App Store (compte développeur Apple payant, Xcode). À écarter au départ. |
| Favori JavaScript (« bookmarklet ») | Partiel | Sans installation, sur ordinateur surtout ; sur téléphone peu pratique. La page de Courses U n'a qu'une CSP `frame-ancestors`, donc un favori peut tourner, mais lire la liste depuis HomeHub demande HTTPS et CORS côté HomeHub ; plus simple : HomeHub met le panier dans le presse-papiers et le favori le lit. |

Lien entre HomeHub et l'extension, sans compte de l'enseigne :

- l'extension est **appairée** au téléphone ou à l'ordinateur comme un appareil HomeHub (même mécanisme que la PWA
  `/m`) et lit le panier à envoyer par l'API de HomeHub ; ou, plus simple au départ, la personne **copie** le panier
  depuis HomeHub (petit JSON) et l'extension le lit dans le presse-papiers ;
- en retour, l'extension renvoie ce qui est parti (identifiant, EAN, prix affiché) pour marquer les lignes et alimenter
  l'historique des prix de la maison.

Fragilité : moyenne à forte. Chaque refonte du site d'une enseigne casse l'extension ; DataDome (Leclerc, Carrefour)
peut juger un enchaînement d'ajouts suspect même à rythme humain, d'où la règle d'arrêt. Courses U (Cloudflare,
limiteur de débit) paraît le plus tolérant, à confirmer en vrai.

### (c) Liste à cocher dans HomeHub, panier rempli à la main

HomeHub affiche la liste rangée **dans l'ordre des rayons de l'enseigne**, avec pour chaque ligne le produit retenu
(nom, contenance, nombre de paquets) et un lien qui **ouvre sa fiche** dans l'appli ou le site de l'enseigne (lien
profond vers `/p/…/<identifiant>.html` chez Courses U) ; on coche au fur et à mesure. Toujours conforme, ne casse
jamais, marche sur tous les téléphones et sur la tablette (liste à côté du téléphone qui remplit le panier). C'est la
base indispensable de toute façon : la correspondance produit et l'arrondi au paquet servent aux trois chemins.

Variante utile chez Courses U : constituer une fois une **liste Courses U** des produits habituels (dans leur appli)
et la verser au panier en un geste, HomeHub ne gérant que le complément du menu.

## 3. Tableau comparatif

| Chemin | Faisabilité | Fragilité | CGU | Effort | Tablette | Téléphone |
|---|---|---|---|---|---|---|
| (a) Carrefour dans ChatGPT (liste copiée) | Oui, Carrefour seulement | Faible | Conforme | Très faible | Copier seulement | Bonne si ChatGPT installé |
| (a) Accès partenaire | Improbable | — | Conforme | Démarche écrite | — | — |
| (b) Extension, ordinateur | Oui | Moyenne à forte | Défendable (usage personnel, arrêt sur captcha) ; Leclerc l'autorise explicitement | Moyen : une extension et un « adaptateur » par enseigne | Non (Fully Kiosk) | — |
| (b) Extension, Firefox Android | Oui | Idem | Idem | + publication AMO | — | Bonne, si on accepte Firefox |
| (b) Extension Safari iOS | Oui | Idem | Idem | Fort (appli App Store) | — | iPhone |
| (b) Favori JavaScript | Partiel | Forte | Idem | Faible | Non | Médiocre |
| (c) Liste à cocher + liens vers les fiches | Oui, toutes enseignes | Nulle (liens seulement) | Conforme | Faible | **Bonne** | **Bonne** |

## 4. Correspondance article → produit de l'enseigne

S'appuie sur l'existant : clé normalisée d'ingrédient (`ingredientKey` dans `shared/ingredients.ts`), rayon deviné
(`guessAisle`), quantités par grandeur (`shared/quantities.ts`, dont `parsePackage` pour lire « 400 g »), lignes du
plan de courses (`PlanLine` dans `shared/menu.ts`), produits du stock avec leur EAN et leur contenance
(`server/sources/stock.ts`).

Données à garder (nouveau magasin `drive.json` dans `HOMEHUB_STATE_DIR`, rien de personnel) :

```ts
type DriveProduct = {
  enseigne: 'coursesu' | 'leclerc' | 'carrefour';
  id: string;            // identifiant de l'enseigne (mpn Courses U, ex. « 4863121 »)
  ean: string | null;    // sku du JSON-LD, relie au stock et à Open Food Facts
  name: string;          // « Crozets nature …, 400g »
  pack: Amount | null;   // contenance lue par parsePackage (400 g)
  price: number | null;  // dernier prix vu (magasin choisi), indicatif
  seenAt: string;
};
type DriveChoice = {
  key: string;           // clé d'ingrédient (« lardon ») ou produit hors recette
  enseigne: string;
  preferred: string;     // id du produit retenu
  fallback: string[];    // produits de secours, jamais pris d'office
};
```

Ajusté en 0.53.0 (Drive 1, `shared/drive.ts`) : le produit est rangé **dans** le choix (`preferred: DriveProduct |
null`, `fallback: DriveProduct[]`, trois secours au plus) plutôt que dans une table à part, ce qui suffit tant qu'il
n'y a pas d'historique des prix ; `preferred` peut être vide (produit retenu retiré, aucun secours promu d'office). Le
produit garde aussi le lien de sa fiche, la marque, la contenance écrite (`packText`, en plus de `pack`) et d'où elle
vient (`source` : fiche lue, saisie, ou reprise du stock) ; **pas de prix** (la fiche n'en donne pas sans magasin, il
viendra avec l'extension). Une seule enseigne pour l'instant (`coursesu`), avec un adaptateur par enseigne (domaine,
forme du lien d'une fiche). Le magasin de retrait est un nom libre et, si on veut, le lien de sa page.

Comment on trouve un produit la première fois :

1. **EAN connu** (produit déjà au stock) : on cherche cet EAN chez l'enseigne ; le JSON-LD de la fiche Courses U porte
   l'EAN, donc la correspondance se vérifie sans ambiguïté.
2. Sinon, **recherche par nom** faite *dans le navigateur de la personne* (chemin b) ou par elle-même (chemin c) :
   l'extension propose 3 à 5 résultats, la personne choisit ; HomeHub ne fouille jamais le catalogue depuis le NAS
   (`robots.txt` de Courses U interdit la recherche aux robots, CGU contre l'extraction).
3. Le choix est **retenu** par clé et par enseigne ; on peut le changer, ajouter un produit de secours.

**Arrondi au paquet** : besoin (ex. 350 g de lardons, déjà réduit de ce qui est au stock par « j'en ai déjà ») ÷
contenance du produit retenu (200 g) → **2 paquets**, arrondi au supérieur ; c'est l'arrondi au paquet de la 0.52
(`packsFor` dans `shared/menu.ts`, « 250 g (2 × 200 g) »), repris tel quel avec la contenance du produit retenu
(`drivePacks` dans `shared/drive.ts`, affiché dès Drive 1).
Grandeurs incompatibles (« 2 oignons » contre un filet de 1 kg) : on demande une fois « combien de pièces dans ce
paquet ? » et on le retient sur le choix. Produit au poids ou contenance illisible : 1 paquet, signalé.

## 5. Recommandation

1. **D'abord le chemin (c), sur Courses U** : choix de l'enseigne et du magasin dans les réglages, correspondance
   article → produit retenue (avec EAN quand il est connu), arrondi au paquet, liste ordonnée avec liens vers les
   fiches, cases à cocher et récapitulatif. Utile tout de suite, conforme, solide, et c'est le socle des étapes
   suivantes.
2. **Ensuite une extension « Remplir le panier » (chemin b), Courses U seulement**, pour ordinateur et Firefox
   Android : lit le panier préparé par HomeHub, ajoute les produits depuis la session de la personne à rythme humain,
   s'arrête au premier captcha ou refus, renvoie ce qui est parti. Essai réel avant d'aller plus loin ; on garde la
   méthode « clic sur le bouton » de préférence.
3. **Leclerc et Carrefour plus tard**, seulement si le besoin existe : Leclerc est le plus clair juridiquement (usage
   personnel autorisé) mais DataDome rend l'extension incertaine ; pour Carrefour, un bouton « Copier pour l'assistant
   Carrefour » suffit.
4. **Créneaux : ne pas les faire.** Aucune voie officielle, ils demandent d'être connecté et viennent juste avant le
   paiement ; on les choisit dans l'appli de l'enseigne. Au mieux, l'extension pourrait afficher le prochain créneau
   lu dans la page, sans réserver.
5. Pas d'iPhone au départ (extension Safari trop lourde) ; sur iPhone, chemin (c).

## 6. Découpage en versions

| Version | Contenu |
|---|---|
| Drive 1 | Réglages : enseigne (Courses U) et magasin de retrait. Magasin `drive.json`. Sur chaque ligne de la liste, « Produit chez Courses U » : choix d'un produit en partageant ou collant le lien de sa fiche (identifiant tiré de l'URL ; la fiche partagée peut être lue une fois à la demande, `/p/` étant autorisé par `robots.txt`, comme une recette ; si Cloudflare refuse, pas de contournement : nom et contenance saisis, ou repris du stock par EAN). Choix retenu, produit de secours. Nombre de paquets affiché (arrondi au paquet de la 0.52). **Fait en 0.53.0.** |
| Drive 2 | Grandeurs incompatibles (« combien de pièces dans ce paquet ? »), mode « Remplir le panier » : liste ordonnée par rayon, liens vers les fiches, cases à cocher, récapitulatif (ce qui part, prix estimé, ce qui reste à acheter ailleurs), lignes marquées comme achetées en drive. |
| Drive 3 | Extension navigateur (ordinateur, puis Firefox Android) : appairage, lecture du panier préparé, recherche dans la page pour choisir un produit, ajout depuis la session, arrêt sur captcha, retour des prix et EAN vers l'historique des prix. |
| Plus tard | Autres enseignes (adaptateur par enseigne), « Copier pour l'assistant Carrefour », prochain créneau affiché ; jamais de réservation ni de paiement. |

## Sources

Pages lues le 12 novembre 2026 : `robots.txt` de coursesu.com, leclercdrive.fr, carrefour.fr, intermarche.com et
auchan.fr ; mentions légales de coursesu.com, mentions légales et charte de leclercdrive.fr, CGU et mentions légales de
carrefour.fr ; une fiche produit et la page des recettes de coursesu.com (JSON-LD et configuration de la page) ;
articles de presse sur l'application Carrefour dans ChatGPT (mars 2026) ; pages de Jow et de Mealz sur leurs enseignes
partenaires.
