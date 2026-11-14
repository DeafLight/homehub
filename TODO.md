# À faire

## Vérifier en conditions réelles (0.30)

- [ ] Carte trajet en journée : la course prévue est bien reconnue dans le temps réel (« annoncé à … », supprimée, manquée).
- [ ] Arrêt desservi dans les deux sens : seul le bon sens est retenu.
- [ ] Page Transports : l'enregistrement fonctionne depuis la tablette.

## Design (piste A « affinée », voir docs/design.md)

- [x] État des lieux : captures de chaque page (tablette et téléphone), incohérences relevées.
- [x] Trois pistes maquettées, piste A retenue.
- [x] Règles communes (espacements, tailles de texte, carte et étiquette) ; accueil (bus sur une ligne par arrêt,
      barre Minuteur · Scanner · Réglages) et dashboards (colonnes de hauteur fixe, Scanner dans le rail) en 0.32.0.
- [ ] Pages suivantes : listes, transports, téléphones, NAS, routines, puis le téléphone (PWA). Semaine et météo
      faites en 0.47.0 (en-tête commun `PageHeader`).
- [x] Noms des matières sans accents (« Mathematiques ») : table de correction des libellés ÉcoleDirecte (0.47.0).
- [x] Pages de réglages : bouton « Enregistré » près des modifications (0.47.0 : enregistrement automatique, état
      dans le titre de la carte modifiée).

## Recettes, menus et drive (prochain gros sujet, avec le redesign)

Idée directrice : le fonctionnement d'une appli comme Jow (recettes de la semaine → liste de courses), mais avec
des recettes de plusieurs sites, et toujours à partir de **notre version** de chaque recette.

- [x] Importer une recette en la **partageant depuis le téléphone** (PWA, « Partager » existe déjà via `/partager`) :
      lien d'une recette de sites à définir (Jow, Marmiton, Moulinex / Cookeo…). Le serveur lit la recette (titre,
      portions, ingrédients avec quantités, étapes, photo, temps ; mode Cookeo s'il y en a) et la range dans le
      carnet, avec sa source. Fait : lecteur générique schema.org (JSON-LD, microdonnées), sans cas par site ;
      saisie à la main si la page n'a rien de lisible ; mode cuisine sur la tablette.
- [x] Notre version : chaque recette importée se personnalise (portions par défaut, ingrédients, quantités, étapes,
      astuces) ; c'est elle qui sert ensuite, la source restant consultable.
- [x] Notes et commentaires de chaque membre sur une recette ; un commentaire peut être résolu (rouvert, toujours
      consultable) ; pastille sur les cartes du carnet, rappel dans le mode cuisine.
- [x] Menu de la semaine (0.51.0) : choisir des recettes et le nombre de personnes pour chacune ; retirer un repas
      d'un geste, avec « Annuler » (0.51.1).
- [x] Liste de courses **agrégée et cohérente** (0.51.0) : quantités mises à l'échelle des portions, même ingrédient
      regroupé entre recettes (unités converties : g / kg, cl / l, cuillères, « 1 oignon »), rangée par rayon ;
      « j'en ai déjà » pour les placards (sel, huile…), d'après le stock (voir « Stock de la maison ») ; on voit de
      quelles recettes vient chaque ligne. Elle rejoint la liste de courses actuelle, avec les produits hors recettes
      (lessive…).
- [x] Menu et stock mieux rapprochés (0.52.0) : un produit qui s'utilise en plusieurs fois (deviné, réglable) a
      peut-être un paquet entamé ; « À vérifier au placard » (« J'en ai assez » / « Il en faut »), la ligne reste
      dans les courses sans décision ; arrondi au paquet (« 250 g (2 × 200 g) »).
- [x] Suite du menu : **frais à acheter plus tard dans la semaine** (0.57.0) : crèmerie, boucherie, fruits et
      légumes d'un repas prévu plus de 3 jours après aujourd'hui attendent « À acheter plus tard », puis rejoignent
      la liste 3 jours avant le repas ; « Acheter maintenant » ; seule la part du repas tardif attend.
- [x] Suite du menu : **catégories Open Food Facts pour deviner un produit relié** (0.62.0) : copiées au scan
      (alimentaire seulement ; fiche plus ancienne relue une fois), elles proposent l'ingrédient quand le nom ne suffit
      pas (« Miettes au naturel » → thon, « Chocolat au lait » → chocolat) ; toujours une proposition, marquée
      « d'après sa catégorie Open Food Facts ».
- [ ] Suites du menu : « brique de crème fraîche » rangée en Autres (unité « brique » à reconnaître) ; capture d'une
      semaine passée.
- [x] Décompter le stock quand on cuisine (0.63.0) : « J'ai cuisiné » à la fin du mode cuisine, sur la fiche du
      téléphone ou sous un repas du menu ; proposé ingrédient par ingrédient, jamais d'office, « Tout comme proposé »,
      « Il en reste » à peu près ¼ · ½ · ¾ gardé par le stock et compté par le menu, annulable ; rappel des repas
      passés sur l'accueil et dans le menu. Proposition et décisions :
      [docs/proposition-decompte-cuisine.md](docs/proposition-decompte-cuisine.md).
- [ ] Drive : remplir le panier d'une enseigne depuis la liste de courses (étude faite, voir « Drive » ci-dessous).
- [x] Groupes du carnet : dans notre version, créer, renommer, monter, retirer un groupe d'ingrédients ou d'étapes
      (« Pour la pâte »), y ranger une ligne ou l'en sortir, ordre et identifiants gardés.
- [ ] Suites du carnet : photo à changer ou à prendre ; doublons par titre (même recette sur deux sites) ; Jow : ses
      CGU interdisent l'extraction, n'importer que ce qu'on partage soi-même (c'est le cas) et ne rien republier.
- [ ] Vérifier en conditions réelles : partager depuis Marmiton, Jow et Moulinex sur un vrai téléphone ; lecture
      des quantités sur une dizaine de recettes (corriger les règles de `shared/ingredients.ts` au besoin).
      Premier essai (mycookeo.fr) : aucune étape, le JSON-LD n'en donnait pas ; corrigé en 0.49.2 (étapes lues sous
      les titres « Étape 1 »… de la page, « Relire la page » pour les recettes déjà importées). Reste : Marmiton,
      Jow, Moulinex et les quantités.
- [x] Site qui refuse la lecture par HomeHub (HTTP 403, ex. un blog Cookeo) : pas de contournement (ni faux
      User-Agent, ni navigateur automatique) ; on passe par le navigateur de la personne : texte copié de la page
      (« Coller », ou partage du texte sélectionné) ou page enregistrée `.mhtml` (partage du fichier, ou choix dans
      l'import), avec un aperçu à corriger avant d'enregistrer (0.50.0).
- [ ] Piste future : lire une recette sur des **captures d'écran** (OCR), à mutualiser avec la lecture des tickets
      de caisse (même moteur, même choix local ou modèle de vision, voir « Stock »).
- [x] À étudier d'abord : pour chaque site visé, ce que la page d'une recette laisse lire (données structurées
      schema.org `Recipe` ?) et dans quelles conditions ; comment reconnaître un ingrédient (« 2 gros oignons
      émincés » → oignon, 2 pièces) pour l'agréger ; pour le drive, quelle enseigne a un panier accessible, et
      comment associer un ingrédient à un produit (et retenir le choix). Fait pour les sites et les ingrédients
      (clé normalisée, rayon deviné, prêts pour la liste agrégée) ; drive étudié à part (`docs/etude-drive.md`).

### Drive (remplir le panier d'une enseigne)

But : depuis la liste de courses (menu et produits hors recettes), retrouver chaque article chez **une enseigne
choisie** et remplir son panier. Le plus important est le panier ; le créneau et le paiement se finissent dans
l'appli de l'enseigne. Étude faite : `docs/etude-drive.md` (Courses U en priorité, Leclerc, Carrefour ; Intermarché
et Auchan vus rapidement).

Jusqu'où on peut aller (conclusions de l'étude) :

| Étape | Faisable ? |
|---|---|
| Chercher les produits, remplir le panier | Aucune API ni import ouvert à un tiers. Liste à cocher avec liens vers les fiches (toutes enseignes), puis extension dans le navigateur de la personne (Courses U d'abord) |
| Voir les créneaux, en réserver un | **Non** : pas de voie officielle, parcours connecté juste avant le paiement ; on le fait dans l'appli |
| Payer | **Non** : HomeHub ne touche jamais aux données de carte ; on valide chez l'enseigne |

- [x] **Étude** (12/11/2026) : voies officielles (aucune ouverte ; Jow et Mealz ont des contrats ; Carrefour a son
      appli dans ChatGPT), pages publiques (fiche Courses U : JSON-LD `Product` avec identifiant et EAN, pas de prix
      sans magasin), CGU et `robots.txt` (Leclerc autorise l'extraction non substantielle à usage personnel ;
      Courses U et Carrefour interdisent l'extraction des bases), anti-robots (Cloudflare chez Courses U, DataDome
      chez Leclerc et Carrefour, défi 403 chez Intermarché). **Pas de contournement**, rien depuis le NAS.
- [x] Drive 1 (0.53.0) : choisir l'enseigne (Courses U) et le magasin de retrait (bouton « Drive » des courses) ;
      ingrédient ou article → **produit de l'enseigne** en partageant ou collant le lien de sa fiche (identifiant de
      l'URL, fiche lue une fois à la demande ou saisie ; nom, contenance et EAN repris du stock), choisi une fois puis
      **retenu** (« gruyère » → tel paquet chez cette enseigne) ; produits de secours, jamais pris d'office ; nombre de
      paquets affiché sous l'article (arrondi au paquet de la 0.52) ; partager une fiche propose « Relier à un article
      de la liste ».
- [x] Drive 2 (0.54.0) : quantité en **paquets** pour tout le panier ; grandeurs incompatibles (« 5 oignons »
      contre un filet de 1 kg) : « Combien de pièces dans ce paquet ? » demandé une fois et retenu sur le produit ;
      contenance inconnue ou au poids : 1 paquet, signalé. Mode « Remplir le panier » (tablette et téléphone) : liste
      dans l'ordre des rayons, bouton « Fiche », cases à cocher pendant qu'on remplit le panier dans l'appli (panier
      en cours gardé par le serveur, « Nouveau panier ») ; récapitulatif (ce qui part, ce qui reste à mettre au
      panier, ce qui s'achète ailleurs ; **sans prix**, ils viendront avec Drive 3) ; lignes cochées passées dans
      « Au drive » de la liste, sans être cochées comme achetées (« Reçu : tout cocher »).
- [x] Drive 3 (0.55.0) : extension « Remplir le panier » (Chrome, Edge, Firefox sur ordinateur, hors boutique ; pas
      Safari iOS), Courses U seulement : panier **copié depuis HomeHub** (onglet « Extension » de Remplir le panier),
      ajout des produits depuis la session de la personne, à rythme humain fixe, **en cliquant les boutons « Ajouter »
      et « + » de la fiche** ; **s'arrête au premier captcha, refus ou page inattendue** ; produit déjà au panier non
      rajouté, indisponible passé ; compte rendu recollé dans HomeHub (articles cochés « au drive », dernier prix et
      EAN lus notés sur le produit, total indicatif au récapitulatif) ; essai premier produit seulement. Sélecteurs
      isolés dans l'adaptateur, éprouvés sur une fausse fiche (`npm run extension:check`).
- [ ] Drive 3, **essai réel** sur le site Courses U (par l'utilisateur, procédure : `docs/etude-drive.md`, section 7) ;
      corriger les sélecteurs de `extension/src/coursesu.ts` d'après la vraie fiche.
- [ ] Drive 3, suite : Firefox Android (extension signée, publication non listée sur addons.mozilla.org, à décider
      après l'essai réel) ; recherche dans la page pour choisir un produit ; prix renvoyés vers un historique des prix
      (voir « Prix ») ; appairage de l'extension comme un appareil (adresse de HomeHub choisie à l'installation, CORS
      limité à l'extension, jeton d'appareil) si le copier-coller pèse à l'usage.
- [x] Article introuvable ou en rupture : il reste dans la liste classique, signalé ; produit de remplacement
      proposé, jamais choisi d'office. **Fait en 0.60.0** : signalé par l'extension (indisponible, ou fiche
      introuvable passée) ou à la main (« Introuvable ? »), remplacement pour ce panier par un secours ou un autre
      produit par sa fiche, trace de la rupture sur le produit.
- [ ] Plus tard, si besoin : autres enseignes (un adaptateur chacune ; Leclerc incertain à cause de DataDome),
      « Copier la liste pour l'assistant Carrefour » (appli Carrefour dans ChatGPT), prochain créneau affiché par
      l'extension, sans réserver.
- [ ] Compte de l'enseigne : jamais de mot de passe ni de jeton de session stocké par HomeHub (le chemin retenu passe
      par le navigateur de la personne).

## Stock de la maison (sujet à part, utile aux recettes et au-delà)

Fait en 0.33.0 (scanner et page Stock, voir README) :

- [x] Entrées : codes-barres des courses scannés (caméra de la tablette ou du téléphone, ou tapés), produit reconnu
      dans Open Food Facts, puis Open Beauty Facts et Open Products Facts (hygiène, lessive, entretien).
- [x] Sorties : paquet vide scanné, ou « Épuisé » / − 1 à la main sur la page Stock.
- [x] Produit épuisé : proposition de liste de courses (Oui / Oui, et toujours d'office / Non), réglage par produit et
      par défaut.
- [x] Sortie d'un produit absent du stock (entrée oubliée) : acceptée, « Il en reste ? » (0 par défaut, le reste
      entre sans prix), puis la proposition de liste de courses ; jamais de stock négatif ; entrée oubliée notée.
- [x] Recharges et contenants de la maison : « Transvasé » ou « Épuisé », choix retenu par produit ; contenant vide
      (scan de son étiquette ou bouton « Vide ») → même proposition ; étiquette EAN-13 interne (préfixe 29) à imprimer.
- [x] Code-barres inconnu : saisi (nom, marque, contenance, rayon) et gardé.
- [x] Copie locale des produits : base relue au-delà de 180 jours ou sur « Revérifier » ; la correction l'emporte.
- [x] Correction : fiche du produit (provenance et date), « Ce n'est pas ça ? » → Revérifier (différences, à prendre
      ou non) ou Corriger.
- [x] Versions datées d'un produit ; une relecture de la base qui contredit une correction est signalée, sans rien
      changer.
- [x] Le stock déjà présent s'enregistre aussi (scan ou + 1), sans prix.
- [x] Heure et auteur de chaque entrée et sortie (profil du téléphone, personne reconnue sur la tablette, sinon
      anonyme), affichés dans le scanner, la liste du stock et l'historique de la fiche (0.34.0) ; produit épuisé : seulement quand
      et par qui, lignes qui ne débordent plus (0.34.1).
- [x] Écran de scan : bip et éclair à chaque lecture, bordure qui pulse et « Retire le produit » : rien n'est relu
      tant que le code reste devant la caméra.

Reste :

- [ ] Vérifier sur la tablette et un téléphone : lecture en continu, bip (son autorisé par Fully Kiosk ?), « Retire le
      produit » au bon moment, distance de lecture des petits codes (EAN-8), étiquette imprimée bien lue.
- [x] Affichettes à imprimer pour le frigo et la poubelle (« scanne avant de ranger / jeter »), QR code vers le
      scanner du téléphone dans le bon mode (`?mode=ranger` / `?mode=jete`) (`npm run affichettes`, 0.70.0).
- [x] Inventaire consultable depuis le téléphone (page Stock de la PWA, `/m/stock`, 0.35.0 ; sans date ni auteur, 0.35.1).
- [x] « J'en ai déjà » des recettes, d'après le stock (menu de la semaine, 0.51.0).
- [x] « Épuisé » sur chaque produit de la page Stock, même s'il n'en reste qu'un (grisé une fois épuisé, 0.58.0).
- [x] Produit sans code-barres (marché, vrac, fait maison) : nom, rayon, quantité avec unité, sur la tablette et le
      téléphone ; identifiant interne, rien envoyé à la base ; ensuite comme les autres (menu, épuisé, quantité) (0.61.0).
- [x] Dates de péremption (0.64.0, [proposition](docs/proposition-peremption.md)) : lots datés (DLC ou DDM), pastille
      « Date ? » non bloquante au scan et pavé de date, sortie du lot le plus proche (FEFO, « Lequel ? » s'il y en a un
      passé), filtre « À consommer » (« Jeté », « Encore bon »), produits jetés périmés ce mois-ci.
- [x] Dates estimées par rayon pour les frais sans date imprimée, durée corrigeable par produit ; réglage des seuils et
      des durées (tablette, un parent, enregistré à chaque changement) (0.64.0).
- [x] Carte « À consommer » sur l'accueil de la tablette et le dashboard d'un parent (DLC passées ou urgentes) (0.64.0).
- [x] Menu : « À cuisiner d'abord » (recettes du carnet qui utilisent ce qui arrive à date) et avertissement quand le
      stock finit (DLC) avant le repas, « Avancer le repas » (0.64.0).
- [ ] Dates de péremption, plus tard : lire la date toute seule (codes 2D GS1 avec date sur les produits frais, ou OCR
      de la date imprimée), à décider avec le moteur OCR des tickets ; rappel par notification (avec Web Push).
- [ ] Plus tard, en option : renvoyer une correction à Open Food Facts avec le compte de l'utilisateur, seulement à
      sa demande.
- [x] Relier un produit scanné à un ingrédient de recette (0.51.0, deviné puis confirmé une fois) (« Lardons fumés
      Herta 2×75 g » → lardons, 150 g).

### Prix (suite du stock)

- [ ] Photo du ticket de caisse (tablette, ou téléphone par la PWA ; plusieurs photos pour un long ticket), lu par
      OCR : Tesseract en local (gratuit, rien ne sort, découpage des lignes à notre charge) ou modèle de vision par
      API (bien plus fiable sur la structure : multiples, prix au kilo, remises ; l'image sort de la maison). À choisir.
- [ ] Rapprocher les lignes du ticket (libellés abrégés, sans code-barres) des produits scannés le même jour :
      marque, mots, contenance, quantités ; association confirmée retenue par enseigne, reconnue seule ensuite.
      Écran de vérification : sûres, à confirmer, sans produit (au poids, non scanné).
- [ ] Le prix est facultatif (déjà prévu par l'API du stock, pas encore saisi) : sans ticket, ou pour le stock déjà
      présent, l'entrée n'a pas de prix (et les calculs de coût le disent : « prix connu pour 8 ingrédients sur 10 »).
- [ ] Ce qu'on en tire : historique du prix par produit, date et magasin ; coût d'une recette (notre version) et du
      menu de la semaine.
- [ ] À étudier : commandes drive (produit, prix et code-barres exacts, sans OCR) ; Open Prices (Open Food Facts),
      prix par produit et magasin, à lire et peut-être à alimenter.

## Téléphone

- [x] Sport (0.36.0) : programme de renforcement, rythme adapté chaque semaine, difficulté et gênes par exercice,
      catalogue des exercices en texte.
- [x] Sport, 0.37.0 : animation de chaque exercice (bonhomme en 2 à 4 positions, ralenti), vignettes, et muscles sur
      une silhouette face et dos.
- [x] Sport, 0.38.0 : séance guidée sur la tablette (échauffement, compte à rebours, tours, bips, exercice suivant
      pendant le repos), carte « séance du jour » ; profil choisi par la reconnaissance faciale ; rien de personnel
      affiché (ni tour de taille, ni notes, ni historique). Pendant la séance guidée, le profil reste connecté : ni
      fin de la session de la personne reconnue (`faces.sessionMinutes`), ni retour à l'accueil sans contact
      (`ui.idleTimeoutSeconds`), ni veille (`ui.screensaverMinutes`), même loin de la caméra et sans toucher l'écran.
      En quittant la séance (fin, abandon, retour), tout reprend comme d'habitude, délais repartis de zéro.
- [x] Sport, 0.43.0 : programme revu. Changement de côté à la moitié de l'effort (bip et « Change de côté » sur la
      tablette) ; réglage « élastique de tirage » (rowing à l'élastique pour le dos de chaque séance) ; bilan qui monte
      dès 2 bonnes séances, demandé une fois la semaine finie ; palier suivant en deux temps (la moitié des exercices
      d'abord, l'autre au bon bilan suivant), exercices changés signalés ; réglage « sans sauts ».
- [x] Tâches, 0.64.1 : le bouton de la personne du téléphone ne disparaît plus après « Tous » (épinglé, même à 0) ;
      ouverture sur « Tous » quand elle n'a rien à faire. Même règle sur la tablette pour le profil d'origine.
- [x] Caméra en direct, 0.65.0 : onglet Caméra des parents, la caméra de face de la tablette en direct avec le son
      (WebRTC, relais TURN pour la 4G) ; bandeau « Caméra en direct · <parent> » sur la tablette (désactivable),
      arrêt en quittant l'onglet, page masquée ou au bout de `camera.maxMinutes` ; caméra partagée avec la
      reconnaissance faciale et le scanner.
- [x] Caméra en direct, vérifiée en conditions réelles (13 novembre) : Fully Kiosk (caméra et micro autorisés, écran allumé,
      détection de mouvement coupée), un téléphone en 4G avec coturn sur le NAS, le son à l'ouverture de l'onglet.
- [x] Parler à la tablette, 0.66.0 : bouton Parler / Arrêter de parler dans l'onglet Caméra (micro ouvert), carillon
      puis la voix sur les haut-parleurs de la tablette, bandeau « Alex parle » toujours affiché ; son de la tablette
      coupé sur le téléphone pendant ce temps ; `camera.talk` (activé par défaut).
- [ ] Parler à la tablette, à vérifier en conditions réelles : lecture automatique dans Fully Kiosk (*Autoplay
      Videos* / *Autoplay Audio*), volume, écho côté tablette.
- [x] Message à la télé, 0.67.0 : bouton dans l'onglet Caméra des parents, texte de 140 caractères au plus, nettoyé
      par le serveur, affiché 10 s (`tv.seconds`) en gros au centre de la télé Android TV, par-dessus l'image (appli
      Notifications for Android TV, requête HTTP locale) ; `tv.host` dans homehub.yaml ; fausse télé du monde fictif.
- [ ] Message à la télé, à vérifier sur la vraie télé : appli installée et autorisée (*Afficher par-dessus les autres
      applis*), message bien au centre et assez gros (police « max »), durée de 10 s respectée, affichage par-dessus
      Netflix / YouTube / la télé en direct et sur l'écran de veille, accents et emojis, titre « Message d'Alex ».
- [x] Destination du micro, 0.68.0 : « Ta voix sur » Tablette (en direct) ou un appareil Google Cast (Google Home,
      télé Android TV) : message enregistré puis lu par le récepteur média par défaut (Cast v2, client sans
      dépendance) ; appareils par adresse IP (`cast.devices`, `cast.mediaUrl`), parents seulement, faux appareils
      Cast dans le monde fictif.
- [x] Destination du micro, 0.68.1 : le Google Home ne faisait qu'un bip. HomeHub se déconnectait (CLOSE) dès la
      première réponse de l'appareil, ce qui arrête le récepteur par défaut avant la lecture. Il attend maintenant
      que la lecture démarre, reste connecté jusqu'à la fin du message et raccroche sans CLOSE. Vérifié depuis un PC
      sur le Google Home mini (13 novembre) : adresse en http et webm/opus de Chrome lus, lecture démarrée en 2,7 s.
- [x] Destination du micro, 0.68.2 : la télé (Android TV) lit le message ; le premier lancement du récepteur peut
      dépasser 15 s (page téléchargée sur Internet), HomeHub attend jusqu'à 45 s puis 20 s pour la lecture ; erreur
      qui dit l'étape (lancement, lecture, message jamais téléchargé), étapes dans le journal du conteneur ; le
      récepteur est fermé une fois le message lu, l'appareil revient à ce qu'il faisait.
- [ ] Destination du micro, à vérifier sur les vrais appareils : retour à l'appli d'avant sur la télé (télé en
      direct, Netflix : reprise ou pause ?), télé en veille, l'enregistrement d'un iPhone (mp4), volume.
- [ ] Notifications (Web Push dans la PWA) : mot reçu, minuteur qui sonne, heure de partir pour le bus, tâche en
      retard. Sur iPhone, seulement si l'appli est installée sur l'écran d'accueil.

## Télé : appli HomeHub TV (une idée par version)

Petite appli Android TV maison, installée par `adb`, qui se connecte à HomeHub et s'appaire comme un appareil (aucun
port ouvert sur la télé). La télé est un écran partagé : rien de personnel n'y apparaît, sauf à la demande de la
personne depuis son propre téléphone.

- [x] Plan de l'appli (`docs/appli-tele.md`) : architecture, outils à installer, mise en place sur la télé, ordre.
- [x] 1. Message vocal sans couper la vidéo : son du programme baissé pendant le message, bandeau « Message d'Alex »
      (0.69.0) : appli `tv-app/` (Kotlin, sans bibliothèque), appairage par code tapé sur la tablette (Téléphones ›
      Télés), interrogation longue, compte rendu au téléphone, télé absente signalée ; destination « Télé du salon »
      dans l'onglet Caméra des parents ; fausse appli dans le monde fictif.
- [x] 1 bis. Vérifié sur la vraie télé (Android 11, avant publication, contre le monde fictif par `adb reverse`) :
      appairage par code, message lu en 0,2 à 0,3 s, son baissé puis rendu sans pause sous YouTube et sous l'appli
      TV de la box (le système baisse le son lui-même, `LOSS_TRANSIENT_CAN_DUCK`), bandeau affiché.
- [x] 1 bis, 0.69.1 : un vrai message du téléphone (1 s, webm/opus) affichait le bandeau sans son, pour toujours. Le
      lecteur n'était gardé par rien et le ramasse-miettes le finalisait pendant la lecture ; il est gardé dans un
      champ, et un garde-fou (durée + 3 s, 40 s si inconnue) termine la lecture et cache le bandeau quoi qu'il arrive.
- [ ] 1 ter. À vérifier après déploiement : appli vivante après veille et redémarrage de la télé ; Netflix.
- [ ] 2. Message écrit en bandeau, à la place de l'appli tierce « Notifications for Android TV » (0.67.0).
- [ ] 3. Alerte du minuteur de cuisine sur la télé.
- [ ] 4. Alerte du bus du matin (« Bus dans 5 min »).
- [ ] 5. Rappels des routines du soir et des nouveaux mots.
- [ ] 6. Pause, reprise et volume de ce qui passe, depuis le téléphone ou la tablette (« À table ! » met en pause).
- [ ] 7. Télé allumée ou éteinte : sinon, l'annonce part sur le Google Home.
- [ ] 8. Écran de veille HomeHub : météo, agenda de la famille, menu du soir.
- [ ] 9. Parler en direct à la télé (comme à la tablette en 0.66.0), son du programme baissé.
- [ ] 10. Réponse depuis la télécommande sous un message (« OK », « J'arrive », « 5 minutes »), affichée sur le
      téléphone de l'expéditeur.
- [ ] 11. Partager une photo ou une vidéo vers la télé depuis le menu Partager du téléphone.
- [ ] 12. Séance de sport guidée sur la télé, lancée depuis le téléphone de la personne (seule elle peut la lancer).
- [ ] 13. Mode cuisine d'une recette sur la télé : étapes en grand, minuteurs intégrés.
- [ ] 14. Alerte pluie avant de sortir, par-dessus le programme du matin.
- [ ] 15. Mode « film » : pendant un film, les annonces partent sur le Google Home ou en bandeau discret.
- [ ] 16. Heure du coucher des enfants : rappel, puis pause, puis écran de veille ; un parent garde la main depuis
      son téléphone.

## École

- [x] Vacances scolaires (académie ou zone, calendrier officiel) : compte à rebours 3 semaines avant, dernier jour,
      « reprise lundi 4 janvier » (accueil, dashboards, agenda du téléphone) ; pendant les vacances, ni trajet du matin,
      ni cours, ni devoirs pour ces jours-là, routines sans les étapes des jours d'école et aux heures du week-end
      (0.44).
- [x] Vacances scolaires réglées depuis la tablette (roue dentée) : académie cherchée dans une liste regroupée par
      zone, ou zone A, B ou C, ou aucune ; aperçu des prochaines vacances avant d'enregistrer (0.45).
- [x] Jours fériés (calendrier officiel) : comme un jour de vacances pour l'école (trajet, cours, routines) ;
      « Férié · 11 novembre », la veille « Demain férié » (0.46).
- [x] Vie scolaire en lecture seule (ÉcoleDirecte, Pronote) : notes récentes, absences et retards, messages de
      l'établissement, sur le dashboard d'un parent et le téléphone d'un parent (0.48).

## Famille

- [ ] Récompenses : points pour les routines terminées et les tâches faites, échangés contre ce que fixent les
      parents (temps d'écran, sortie…).

## Robustesse

- [x] Sauvegarde du dossier d'état (stock, listes, visages, routines, réglages transports) : `/state` est couvert par la
      sauvegarde nocturne du NAS (vérifié le 2026-11-09). Reste à tester une restauration.
- [ ] Alerte sur le téléphone d'un parent quand une source reste en erreur plusieurs heures (dépend des
      notifications).
- [x] Sécurité (0.40.0, revue de code §1 et §5) : `X-Real-IP` / `X-Forwarded-For` crus seulement venant d'un proxy
      de confiance (`trustedProxies`) ; base de produits (`scan`, `recheck`) réservée à la tablette et aux téléphones.
- [x] Refonte (0.42.0, revue de code §8, §10, §12 à §14) : minuteur de séance testé, verrou d'écran qui ne fuit
      plus, cinq écrans découpés (logique testée dans `web/src/lib/`), types d'API partagés, tests des sources.
- [x] Visages (0.49.1) : une tablette qui calcule la même empreinte pour tous les visages (WebView qui fausse le calcul
      par la carte graphique) ne peut plus abîmer les profils : prises anormalement uniformes refusées, profils déjà
      touchés signalés ; calcul des empreintes réglable (`faces.backend` : `webgl`, `webgl-safe`, `cpu`).

## Transports (après le design)

- [ ] Accueil : bloc bus compact, une ligne par arrêt avec le prochain passage par ligne, alertes en icône, tableau
      complet en touchant le bloc (maquette du 2026-11-05).
- [ ] Trajet retour, en fin de cours.
