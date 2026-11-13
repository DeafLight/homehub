# Architecture

Diagrammes en [Mermaid](https://mermaid.js.org) : GitHub les affiche directement. Le détail des fichiers et des
routes reste dans le [README](../README.md#architecture).

## Déploiement

Tout tourne sur le NAS, dans un seul conteneur. Les appareils de la maison passent par Nginx Proxy Manager, ouvert au
réseau local et au VPN seulement.

```mermaid
flowchart LR
  subgraph maison["Maison (Wi-Fi ou VPN WireGuard)"]
    tablette["Tablette<br/>Fully Kiosk<br/>caméra (visages)"]
    tel["Téléphones<br/>PWA /m"]
  end
  subgraph nas["NAS TrueNAS"]
    npm["Nginx Proxy Manager<br/>liste « LAN + VPN »"]
    subgraph conteneur["Conteneur homehub (Node 24)"]
      api["API Hono<br/>/api/*"]
      front["Front Svelte compilé<br/>web/dist"]
    end
    yaml[("homehub.yaml<br/>lecture seule")]
    etat[("Dossier d'état<br/>*.json, irigo-gtfs.zip")]
    releve[("nas-status.json")]
    cron["Tâche cron<br/>nas-status.sh"]
  end
  subgraph ext["Services externes"]
    meteo["Open-Meteo<br/>Météo-France"]
    ical["Agendas iCal"]
    ecole["ÉcoleDirecte / Pronote"]
    irigo["Irigo : SIRI (Ara),<br/>GTFS-RT, GTFS"]
    ign["Géoplateforme IGN<br/>(adresses)"]
    off["Open Food Facts,<br/>Beauty, Products<br/>(produits)"]
    edu["data.education.gouv.fr<br/>(vacances scolaires)"]
    cuisine["Sites de recettes<br/>(page partagée seulement)"]
    enseigne["Enseigne de drive<br/>(fiche produit partagée,<br/>lue une fois à la demande)"]
  end
  subgraph perso["Ordinateur de la personne"]
    extension["Navigateur + extension<br/>« Remplir le panier »<br/>(son compte chez l'enseigne)"]
  end
  extension -- "fiches ouvertes,<br/>boutons cliqués" --> enseigne
  tel -. "copier-coller :<br/>panier, compte rendu" .- extension
  tablette -- HTTPS --> npm
  tel -- HTTPS --> npm
  npm --> api
  npm --> front
  api --- yaml
  api --- etat
  cron --> releve --> api
  api --> meteo & ical & ecole & irigo & ign & off & edu & cuisine
```

## Couches du serveur

Les routes restent fines : une garde d'accès, `readBody` pour le corps, un appel au service, du JSON. Un refus se
lève (`fail`, `HttpError`) et `server/http.ts` le traduit en `{error, identify?}` sur chaque routeur. Le service ne
connaît ni HTTP ni la façon dont une source obtient ses données. `server/app.ts` monte un routeur par groupe
(`*-api.ts`) ; `server/index.ts` assemble le tout (injection de dépendances). Les fichiers d'état passent tous par
`sources/json-file.ts` (écriture atomique, mémoire remplacée seulement une fois le fichier écrit).

```mermaid
flowchart TB
  subgraph http["HTTP (server/app.ts, *-api.ts, http.ts)"]
    routes["Routes /api/*<br/>readBody (zod), fail → {error}"]
    access["access.ts, pin-gate.ts<br/>qui appelle : tablette, téléphone, personne ;<br/>gardes qui lèvent un refus"]
    household["household.ts<br/>membres de la famille"]
    rights["shared/rights.ts<br/>qui peut écrire sur quel profil"]
  end
  subgraph services["Services"]
    dash["services/dashboard.ts<br/>accueil, dashboards, semaine"]
    transitS["services/transit.ts<br/>passages, trajet du matin"]
    facesS["services/faces.ts<br/>reconnaissance, session"]
    stockS["services/stock.ts<br/>scan, entrées, sorties, courses"]
    nasS["services/nas.ts<br/>page NAS"]
    recipesS["services/recipes.ts<br/>import d'une recette, notre version"]
    menuS["services/menu.ts<br/>courses du menu, synchronisées avec la liste"]
    cookS["services/cook.ts<br/>J'ai cuisiné : décompte du stock"]
  end
  subgraph sources["Sources (server/sources/)"]
    distant["Distantes, en cache<br/>open-meteo, ical, ecoledirecte, pronote,<br/>irigo, gtfs, geocode, school-holidays,<br/>open-food-facts (sans cache : copie dans stock),<br/>web-page + recipe-page (sans cache : copie dans recipes),<br/>drive-page (sans cache : copie dans drive)"]
    locales["Locales, fichiers JSON (json-file.ts)<br/>lists, notes, routines, routine-plans,<br/>timers, devices, pins, faces,<br/>transit-settings, stock, fitness, recipes, menus, drive"]
    cache["refreshing-cache.ts<br/>rafraîchit, garde la dernière valeur"]
    status["source-status.ts<br/>dernier succès ou erreur"]
  end
  config["config-store.ts<br/>YAML, rechargé à chaud"]
  horloge["Horloge injectée<br/>(tests à date fixe)"]

  routes --> access --> rights
  access --> household
  routes --> dash & nasS & facesS & stockS & recipesS
  recipesS --> distant
  dash --> transitS --> distant
  routes --> locales
  dash --> distant & locales
  nasS --> status
  distant --> cache
  distant --> status
  dash --> config
  dash --> horloge
```

## Front

```mermaid
flowchart LR
  main["main.ts<br/>API, routeur, horloge<br/>→ contexte Svelte"] --> app["App.svelte<br/>écran courant, retour à l'accueil,<br/>surveillance de version"]
  app --> ecrans["screens/<br/>Home, Dashboard, Week, Weather,<br/>Lists, Stock, Scan, Routines, Transit,<br/>Recipes, Recipe, Phones, Faces, Nas,<br/>Phone (PWA)"]
  ecrans --> comp["components/<br/>cartes, panneaux, minuteurs"]
  comp --> widgets["components/widgets/<br/>affichage pur"]
  ecrans --> lib["lib/<br/>logique sans DOM, testée<br/>(formats, semaine, trajets, routines…)"]
  app -. "toutes les 30 s" .-> health["/api/health<br/>version, révision de config"]
  health -. "changée" .-> reload["Rechargement de la page"]
```

## Modèle de données

Les principaux types de `shared/types.ts` (et `shared/recipes.ts` pour le carnet), partagés par le serveur et le front, et le fichier d'état qui les garde.

```mermaid
classDiagram
  direction LR
  class Member {
    id
    name
    color
    parent
    ecoledirecte / pronote
  }
  class ListTask {
    label
    ownerId
    due
    repeat
    done
    addedBy / doneBy : Author
  }
  class ShoppingItem {
    label
    done
    addedBy / doneBy : Author
  }
  class Note {
    text
    to
    from : Author
    at
    seenAt
  }
  class RoutinePlan {
    morning : RoutineStepPlan[]
    evening : RoutineStepPlan[]
  }
  class RoutineStepPlan {
    id
    label
    days
  }
  class Timer {
    label
    durationSeconds
    endsAt
    startedBy : Author
  }
  class Device {
    ownerId
    name
    system
    tokenHash
  }
  class TransitPlace {
    label
    icon
    address
    lat / lon
  }
  class CommuteSettings {
    from / to : TransitPlace
    route : CommuteRoute
    mode : school | window
    days
    arriveBefore
    walkFrom / walkTo
  }
  class Product {
    code
    current : ProductVersion
    autoShop
    refill : Container
    conflict
  }
  class ProductVersion {
    name / brand / quantity / category
    from
    source : base | manual
  }
  class Movement {
    at : date et heure du scan
    kind : in | out | refill | adjust | container-empty
    quantity / price
    forgotten
    by : Author
  }
  class Container {
    code : EAN-13 préfixe 29
    name
    full
  }
  class Recipe {
    id
    ours : RecipeContent
    source : url, site, imageUrl, content lu
    photo
    addedBy, updatedBy
  }
  class RecipeContent {
    title
    servings, servingsUnit
    steps, tips
    prep / cook / totalMinutes
    appliance : cookeo
  }
  class IngredientLine {
    text (ligne d'origine)
    quantity, quantityMax, unit
    name, key, aisle, section
    optional, manual
  }
  class RecipeNote {
    text
    by, at
    editedBy, editedAt
    resolvedBy, resolvedAt
  }
  class Author {
    ownerId
    via : tablet | phone
  }
  Member "1" --> "*" ListTask : lists.json
  Member "1" --> "*" Note : notes.json
  Member "1" --> "1" RoutinePlan : routine-plans.json
  RoutinePlan "1" --> "*" RoutineStepPlan
  Member "1" --> "*" Device : devices.json
  Member "1" --> "0..1" CommuteSettings : transit-settings.json
  CommuteSettings --> TransitPlace
  ShoppingItem ..> Author
  ListTask ..> Author
  Note ..> Author
  Timer ..> Author
  Product "1" --> "*" ProductVersion : stock.json
  Product "1" --> "*" Movement
  Movement ..> ProductVersion : en vigueur à sa date
  Product ..> Container
  Movement ..> Author
  Recipe "1" --> "1..2" RecipeContent : recipes.json
  RecipeContent "1" --> "*" IngredientLine
  Recipe ..> Author
  Recipe "1" --> "*" RecipeNote : recipe-notes.json
  RecipeNote ..> Author
```

| Fichier d'état | Contenu |
|---|---|
| `lists.json` | courses et tâches |
| `notes.json` | mots (effacés une fois vus, ou au bout de 7 jours) |
| `routines.json` | étapes cochées du jour, jours de suite |
| `routine-plans.json` | étapes et heures des routines |
| `timers.json` | minuteurs en cours |
| `stock.json` | produits (copie de la base et versions corrigées), quantités, mouvements, contenants |
| `recipes.json`, `recipes/` | carnet de recettes : notre version, la version lue et son adresse ; photos (une par recette) |
| `recipe-notes.json` | notes de la famille sur les recettes (texte, auteur, date ; modifiée, résolue par qui et quand) ; à part du carnet pour qu'une note ne touche pas notre version, retirées avec leur recette |
| `menus.json` | menus par semaine (recettes, personnes, jour ; 12 semaines gardées), « j'en ai déjà », décisions « à vérifier au placard », frais avancés (`now`, « Acheter maintenant »), placards, produits du stock reliés aux ingrédients (et s'ils s'utilisent en plusieurs fois) |
| `drive.json` | drive : enseigne et magasin de retrait ; par article (clé) et par enseigne, le produit retenu et ses secours (identifiant, lien de la fiche, nom, contenance, code-barres, pièces par paquet, dernier prix vu par l'extension) ; le panier en cours (articles de la liste cochés, produit et paquets mis au panier) |

| `devices.json` | téléphones reliés (empreinte du jeton seulement) |
| `pins.json` | codes PIN et code parent (empreintes) |
| `faces.json` | empreintes de visage (aucune image) |
| `transit-settings.json` | lieux, trajets, arrêts de l'accueil |
| `pronote.json` | jeton Pronote, renouvelé à chaque connexion |
| `irigo-gtfs.zip` | horaires théoriques Irigo, une fois par semaine |

## Qui écrit

```mermaid
flowchart TD
  req["Requête qui modifie"] --> qui{"Qui appelle ?"}
  qui -- "clé X-Kiosk-Key, connexion locale directe<br/>ou adresse de la tablette" --> tab["Tablette"]
  qui -- "Authorization: Bearer<br/>jeton connu" --> phone["Téléphone relié<br/>au nom de son profil"]
  qui -- "autre" --> lecture["403 : lecture seule"]
  tab --> session{"X-Actor-Session<br/>valide ?"}
  session -- non --> identify["403 identify: true<br/>bulle « Regarde la tablette »"]
  session -- oui --> acteur["Personne reconnue"]
  acteur --> droit{"Parent ?<br/>ou son propre profil ?"}
  phone --> droit
  droit -- oui --> ok["Écriture"]
  droit -- non --> ro["403 « Lecture seule : profil de … »"]
```

Exception : le **stock** (scanner, page Stock) n'attend pas de visage reconnu, puisque la caméra de la tablette sert
alors à lire les codes-barres. La tablette ou un téléphone relié suffit ; le mouvement est noté au nom de la personne
reconnue s'il y en a une (ou du profil du téléphone). Même garde pour la base de produits (`scan`, `recheck`), qui
appelle Open Food Facts.

Les **recettes** : le carnet est familial. Ajouter (importer un lien, saisir à la main) : quelqu'un de reconnu sur la
tablette ou un téléphone relié, vérifié avant toute lecture du site ; modifier notre version : un parent ou qui l'a
ajoutée ; retirer : un parent. Les **notes** sur une recette : tout le monde les lit ; tout membre identifié en
laisse (enfants compris) ; les modifier, les résoudre, les rouvrir ou les retirer : leur auteur ou un parent
(`access.authorOrParent`, même règle que l'écriture sur un profil, qui sert aussi pour modifier notre version) ; un
appareil non appairé ne fait que lire. 1 000 caractères par note, 100 notes par recette. La lecture d'une page (`sources/web-page.ts`) n'accepte que `http`/`https` vers une
adresse publique (vérifiée après résolution DNS, et de nouveau à chaque redirection, quatre au plus), 3 Mo et 10 s au
plus ; `recipes.allowedHosts` autorise nommément un site de la maison. Limite connue : un nom qui change d'adresse
entre la vérification et la connexion (rebinding DNS) n'est pas couvert.

Le **menu de la semaine** : tout le monde le lit, seul un parent le modifie (recettes, « j'en ai déjà », placards,
produits reliés), sur la tablette (parent reconnu) ou depuis son téléphone. Ses courses rejoignent `lists.json` par
une règle de synchronisation (`shared/menu.ts`) appliquée après chaque changement du menu, du stock ou du carnet, et
au premier affichage d'un nouveau jour (`refreshIfNewDay`) : une ligne ouverte marquée `menu` suit le calcul (mise à jour ou
retirée) ; une ligne cochée, ou vidée (gardée dans `cleared` pour sa semaine), compte comme achetée et n'est jamais
touchée, seul le complément revient sur une nouvelle ligne ; une ligne ajoutée à la main pour le même ingrédient
l'emporte ; retirer une ligne du menu vaut « j'en ai déjà » pour sa semaine. Ce qu'il faut est déduit dans cet ordre :
placards, « j'en ai déjà », ligne à la main, déjà acheté, puis stock (partagé entre les semaines, la plus proche
d'abord). Le stock n'est jamais décompté d'office : « J'ai cuisiné » (`services/cook.ts`, règles dans
`shared/cook.ts`, toute la famille) propose ingrédient par ingrédient ; les réponses deviennent des mouvements du stock
groupés sous un même décompte (`cook`), annulables d'un coup, et le repas est noté `cooked` dans `menus.json` (qui,
quand, « j'en ai déjà » et « J'en ai assez » retirés par un paquet fini, gardés pour l'annulation). Un repas noté
cuisiné ne compte plus dans les besoins que pour ses ingrédients restés sans réponse ; la part restante d'un paquet
entamé (`opened`, ¼ ½ ¾) compte sûre dans le stock.

**Frais à acheter plus tard** : chaque besoin garde ses parts jour de repas par jour de repas (`parts`). Une part
fraîche (`isFresh` : rayon deviné ou choisi parmi Fruits et légumes, Boucherie, Poissonnerie, Crèmerie, Boulangerie,
moins une courte liste de produits qui se gardent) dont le jour d'achat (`FRESH.days` = 3 jours avant le repas) est
après aujourd'hui attend : elle n'entre pas dans les lignes voulues (`desiredLines`), donc ni sur la liste ni au drive.
Les déductions (acheté, stock) s'appliquent au besoin entier et couvrent d'abord les premiers repas : ce qui reste à
acheter revient aux parts les plus tardives. La synchronisation tournant à chaque nouveau jour, une part rejoint la
liste d'elle-même le jour venu, sur la ligne ouverte de son ingrédient (ou une nouvelle, si celle-ci est cochée).
« Acheter maintenant » range la clé dans `menus.json` (`now`, par semaine ; `PUT /api/menu/now`, un parent) : plus
rien n'attend pour cet ingrédient cette semaine. `GET /api/lists` renvoie les parts qui attendent (`later`) à côté de
la liste.

Le stock sait qu'un paquet est entré et pas encore sorti, pas combien il en reste. D'où la règle du **paquet
peut-être entamé** : un produit relié qui s'utilise en plusieurs fois (attribut `partial` du lien ; absent, valeur
devinée : un paquet couvre plus que le plus grand besoin d'une recette du carnet pour cet ingrédient) n'a que
(nombre − 1) paquets sûrs, le dernier pouvant être entamé ; un produit utilisé en une fois compte en entier.

```mermaid
flowchart TD
  besoin["Besoin de la semaine<br/>(après placards, coche, main, acheté)"] --> surs{"Paquets sûrs<br/>suffisent ?"}
  surs -- oui --> stock["En stock : rien à acheter"]
  surs -- non --> entame{"Le paquet entamé,<br/>plein, comblerait<br/>le manque ?"}
  entame -- non --> diff["Acheter la différence<br/>sur les paquets sûrs"]
  entame -- oui --> decision{"Décision d'un parent<br/>(semaine, ingrédient)"}
  decision -- "J'en ai assez" --> assez["Rien à acheter<br/>(le paquet sert cette semaine)"]
  decision -- "Il en faut" --> achat["Dans les courses"]
  decision -- "pas encore" --> doute["Dans les courses,<br/>marqué « à vérifier »"]
```

Les décisions sont rangées par semaine et par ingrédient dans `menus.json` (`checks`) ; seul un parent les prend
(`PUT /api/menu/check`, `access.parent`). Une décision ne compte que si la vérification a lieu d'être : si le stock
change et que les paquets sûrs suffisent, ou qu'un paquet plein ne suffirait plus, elle est ignorée. Un paquet jeté
sans être scanné est rattrapé par la même vérification. Quand un produit est relié à l'ingrédient et que les unités se
comparent, la ligne porte les paquets à acheter (`packs`, « 250 g (2 × 200 g) »), sur la marque `menu` de la liste de
courses comme dans le menu.

Le **drive** (étape 1, voir [l'étude](etude-drive.md)) : aucune enseigne n'ouvre d'API ; HomeHub ne fait que retenir,
pour chaque article de la liste (clé de l'ingrédient, ou du libellé pour un produit hors recettes), un produit de
l'enseigne choisie. Le produit vient du lien de sa fiche, collé ou partagé (`/partager` le reconnaît et propose
« Relier à un article de la liste ») ; l'identifiant est tiré de l'URL (`shared/drive.ts`, un adaptateur par
enseigne : domaine et forme des liens). La fiche est lue une fois, quand la personne le demande, par le même lecteur
de pages que les recettes (`sources/drive-page.ts` : seulement une fiche produit de l'enseigne, redirection hors
fiche refusée, JSON-LD `Product`, ni prix ni image) ; un refus du site (anti-robots, 403) est rapporté tel quel et la
personne saisit le produit, ou reprend le nom, la contenance et le code-barres d'un produit du stock. Jamais de
recherche dans le catalogue de l'enseigne. Tout le monde lit `GET /api/drive` ; régler l'enseigne et le magasin : un
parent (`access.parent`) ; lire une fiche et retenir un produit : le droit d'écrire sur la liste de courses
(`access.writer` sur la famille), vérifié avant toute lecture. Un secours n'est jamais pris d'office, même quand le
produit retenu est retiré. Le nombre de paquets reprend l'arrondi de la liste (`packsFor`).

Étape 2, **remplir le panier** : toujours sans rien automatiser chez l'enseigne. `shared/drive.ts` calcule pour chaque
article à acheter ce qu'on met au panier (`driveCount`) : l'arrondi au paquet ; pour une ligne comptée en pièces (ou
gousses, bottes…) contre une contenance d'une autre grandeur ou inconnue, les pièces par paquet demandées une fois et
retenues sur le produit (`pieces`) ; sinon 1 paquet, signalé (contenance inconnue, au poids ou autre grandeur). Un
seul panier en cours dans `drive.json`, dont chaque ligne est liée à un article de la liste par son identifiant : la
ligne marque l'article « au drive » sans toucher à la liste (cocher comme acheté reste un geste de la personne), et
s'efface dès que l'article quitte la liste (retiré, ou vidé du panier une fois acheté) ; `GET /api/drive` ne montre
que les lignes encore liées. Cocher (`PUT /api/drive/basket/:itemId`) : le serveur relit l'article et son produit
retenu et calcule lui-même la ligne (rien n'est repris du front) ; une ligne dont l'article ou le produit a changé
depuis est signalée à l'écran (« Mettre à jour »). Mêmes droits que les choix : `access.writer` sur la famille.

Étape 3, **l'extension « Remplir le panier »** (`extension/`, Manifest V3, Courses U) : elle tourne dans le
navigateur de la personne, sur le site de l'enseigne ouvert et connecté à son compte ; ni le NAS ni HomeHub ne
touchent au site. Aucun réseau entre l'extension et HomeHub : la personne copie le panier (`cartFor`, format
`homehub-drive-cart` de `shared/drive-cart.ts` : article, identifiant, lien de la fiche, paquets) et le colle dans
l'extension, qui le relit (`parseCart` : refus en entier d'un lien qui n'est pas une fiche de l'enseigne) et le garde
dans son stockage local. Le déroulé est une logique pure (`extension/src/run.ts` : décider sur la page ouverte,
passer à la ligne suivante, s'arrêter) ; seul l'adaptateur (`extension/src/coursesu.ts`) connaît la page : JSON-LD
`Product`, boutons « Ajouter » et « + », compteur du panier, prix, défis anti-robots (sélecteurs à confirmer lors de
l'essai réel). Le script de page n'agit que dans l'onglet qui a reçu le remplissage (marque dans l'adresse, retenue
pour l'onglet) et s'arrête au premier captcha, refus, page inattendue ou ajout non confirmé. Le compte rendu
(`homehub-drive-report`), recollé dans HomeHub, part vers `POST /api/drive/report` : le serveur relit chaque ligne
contre la liste (article encore à acheter, lien de fiche de l'enseigne), met au panier en cours le produit et les
paquets que l'extension a vus, et note sur le produit du choix le prix (`price`, dernier vu) et l'EAN s'il manquait ;
même droit que la liste de courses. Le récapitulatif en tire un total indicatif.

**Adresse de la tablette** : c'est l'adresse de la connexion. `X-Real-IP` / `X-Forwarded-For` ne la remplacent que
si la connexion vient d'un proxy de confiance (`trustedProxies`, aucun par défaut). Une connexion locale directe
compte comme la tablette (développement, vérification de santé) ; une adresse locale annoncée par un en-tête, jamais.

## Séquences

### Reconnaissance du visage, puis cocher une tâche

```mermaid
sequenceDiagram
  autonumber
  participant Cam as Caméra
  participant Tab as Tablette (Human)
  participant API as Serveur
  participant F as faces.json
  loop environ 1 analyse par seconde, écran allumé
    Cam->>Tab: image (reste sur la tablette)
    Tab->>Tab: détection, scores « photo » et « écran », empreinte
    Tab->>API: POST /api/faces/identify {embedding, real, live}
    API->>F: comparer aux empreintes enregistrées et apprises
    alt reconnue deux fois de suite
      API-->>Tab: {ownerId, token} (session courte)
      opt sûre et différente des empreintes connues
        API->>F: apprendre une empreinte (au plus 1 / 30 min)
      end
    else inconnue
      API-->>Tab: 401
    end
  end
  Note over Tab: oubliée après 10 s sans être vue
  Tab->>API: PUT /api/lists/tasks/:id {done} + X-Actor-Session
  API->>API: droits : parent, ou son propre profil
  API-->>Tab: tâche à jour
```

### Relier un téléphone

```mermaid
sequenceDiagram
  autonumber
  actor P as Parent
  participant Tab as Tablette
  participant API as Serveur
  participant Tel as Téléphone
  P->>Tab: Téléphones › choisit le profil
  Tab->>API: POST /api/pairing {ownerId, pin?} (personne reconnue)
  API-->>Tab: code (5 min, usage unique)
  Tab->>Tab: affiche le QR code
  Tel->>Tab: scanne le QR code
  Tel->>API: POST /api/pairing/claim {code, name, system}
  API->>API: devices.json : empreinte du jeton
  API-->>Tel: {token, device}
  Tel->>Tel: localStorage : jeton et profil
  Note over Tel,API: ensuite : Authorization: Bearer <jeton><br/>un téléphone retiré reçoit 401 aussitôt
```

### Trajet du matin selon l'emploi du temps

```mermaid
sequenceDiagram
  autonumber
  participant Dash as Dashboard (tablette)
  participant S as services/dashboard.ts
  participant E as ÉcoleDirecte / Pronote
  participant G as GTFS Irigo
  participant R as SIRI temps réel
  Dash->>S: GET /api/dashboard/lea
  S->>E: cours du jour
  E-->>S: premier cours non annulé : 08:30
  S->>S: arriver avant 08:30 − marge − marche à l'arrivée
  S->>G: courses du jour sur la ligne
  G-->>S: dernière course qui arrive à temps : 07:46
  S->>S: partir à 07:46 − marche au départ
  alt dans la fenêtre d'affichage
    S->>R: prochains passages à l'arrêt de départ
    R-->>S: la course de 07:46 annoncée à 07:47
    S-->>Dash: « Pars dans 7 min pour le bus 3 de 07:46 »
  else hors fenêtre, ou jour sans cours
    S-->>Dash: pas de bandeau
  end
```

### Version et déploiement

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Développeur
  participant GH as GitHub (homehub)
  participant CI as GitHub Actions
  participant Reg as ghcr.io
  participant Cfg as nas-config
  participant NAS as NAS
  participant Tab as Tablette
  Dev->>GH: tag vX.Y.Z
  GH->>CI: types, tests, build
  CI->>Reg: image homehub:X.Y.Z
  Dev->>Cfg: compose.yaml : tag X.Y.Z
  Dev->>NAS: git pull --ff-only, update-apps.sh homehub
  NAS->>Reg: docker pull
  Tab->>NAS: /api/health toutes les 30 s
  NAS-->>Tab: nouvelle version
  Tab->>Tab: rechargement
```

## États

### Bandeau du trajet

```mermaid
stateDiagram-v2
  [*] --> Cache
  Cache: Pas affiché
  Cache --> Prevu: fenêtre d'affichage (départ − « afficher avant »)
  Prevu: « Pars dans N min » (horaire prévu)
  Prevu --> Annonce: course trouvée dans le temps réel
  Annonce: « annoncé à … »
  Prevu --> Urgent: dernière minute
  Annonce --> Urgent: dernière minute
  Urgent: orange
  Urgent --> Suivant: heure passée
  Prevu --> Supprime: course supprimée
  Annonce --> Supprime: course supprimée
  Supprime: « supprimé · suivant à … »
  Suivant: bus suivant, ou « Trop tard »
  Suivant --> Cache: départ + 5 min
  Supprime --> Cache: départ + 5 min
```

### Minuteur

```mermaid
stateDiagram-v2
  [*] --> Reglage: bouton minuteur
  Reglage: roue, activité facultative
  Reglage --> EnCours: « Lancer » (quelqu'un de reconnu)
  EnCours: anneau qui se vide<br/>timers.json
  EnCours --> [*]: annulé (quelqu'un de reconnu)
  EnCours --> Sonne: heure de fin
  Sonne: plein écran, réveille la tablette<br/>3 bips répétés, 2 min au plus
  Sonne --> [*]: « Arrêter » (n'importe qui)
```
