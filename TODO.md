# À faire

## Vérifier en conditions réelles (0.30)

- [ ] Carte trajet en journée : la course prévue est bien reconnue dans le temps réel (« annoncé à … », supprimée, manquée).
- [ ] Arrêt desservi dans les deux sens : seul le bon sens est retenu.
- [ ] Page Transports : l'enregistrement fonctionne depuis la tablette.

## Design (en réflexion, rien de décidé)

- [ ] État des lieux : captures de chaque page (tablette et téléphone), incohérences relevées (marges, tailles de
      texte, densité des cartes, navigation, contrastes).
- [ ] Deux ou trois pistes maquettées (accueil et une page secondaire), puis le choix d'une piste.
- [ ] Quelques règles communes (espacements, tailles, composants de carte), appliquées page par page.

## Recettes, menus et drive (prochain gros sujet, avec le redesign)

Idée directrice : le fonctionnement d'une appli comme Jow (recettes de la semaine → liste de courses), mais avec
des recettes de plusieurs sites, et toujours à partir de **notre version** de chaque recette.

- [ ] Importer une recette en la **partageant depuis le téléphone** (PWA, « Partager » existe déjà via `/partager`) :
      lien d'une recette de sites à définir (Jow, Marmiton, Moulinex / Cookeo…). Le serveur lit la recette (titre,
      portions, ingrédients avec quantités, étapes, photo, temps ; mode Cookeo s'il y en a) et la range dans le
      carnet, avec sa source.
- [ ] Notre version : chaque recette importée se personnalise (portions par défaut, ingrédients, quantités, étapes,
      astuces) ; c'est elle qui sert ensuite, la source restant consultable.
- [ ] Notes et commentaires de chaque membre sur une recette ; un commentaire peut être résolu.
- [ ] Menu de la semaine : choisir des recettes et le nombre de personnes pour chacune.
- [ ] Liste de courses **agrégée et cohérente** : quantités mises à l'échelle des portions, même ingrédient
      regroupé entre recettes (unités converties : g / kg, cl / l, cuillères, « 1 oignon »), rangée par rayon ;
      « j'en ai déjà » pour les placards (sel, huile…), d'après le stock quand il existera (voir « Stock de la
      maison ») ; on voit de quelles recettes vient chaque ligne. Elle
      rejoint la liste de courses actuelle, avec les produits hors recettes (lessive…).
- [ ] Secondaire, si possible : envoyer la liste au panier d'un drive (enseigne à définir, type Hyper U) depuis la
      tablette ; ce que le drive n'a pas reste dans la liste classique. HomeHub remplit le panier ; la commande et
      le paiement se valident chez l'enseigne.
- [ ] À étudier d'abord : pour chaque site visé, ce que la page d'une recette laisse lire (données structurées
      schema.org `Recipe` ?) et dans quelles conditions ; comment reconnaître un ingrédient (« 2 gros oignons
      émincés » → oignon, 2 pièces) pour l'agréger ; pour le drive, quelle enseigne a un panier accessible, et
      comment associer un ingrédient à un produit (et retenir le choix).

## Stock de la maison (sujet à part, utile aux recettes et au-delà)

- [ ] Entrées : scanner les codes-barres des courses avec la caméra de la tablette, produit reconnu dans une base de
      codes-barres (Open Food Facts, libre, pour l'alimentaire ; à voir pour la lessive, l'hygiène…), quantité
      ajoutée au stock.
- [ ] Sorties : scanner le paquet vide, ou choisir le produit à la main pour le déclarer épuisé.
- [ ] Produit épuisé : proposer de l'ajouter à la liste de courses (accepter ou non) ; option « l'ajouter
      automatiquement », enregistrée (par produit, avec un réglage par défaut).
- [ ] Sortie d'un produit absent du stock (entrée oubliée) : acceptée sans bloquer ; le produit devient connu ;
      « Il en reste ? » (nombre, 0 par défaut ; le reste entre au stock, sans prix) ; puis la proposition de liste
      de courses habituelle. Jamais de stock négatif ; entrée oubliée notée (pour voir si le scan à l'arrivée est
      souvent oublié).
- [ ] Recharges et contenants de la maison (bidon de lessive, bocal à farine, boîte à café, savon…) : au scan d'un
      emballage vide, « Épuisé » ou « Transvasé » ; transvasé, l'emballage sort mais le produit reste disponible dans
      le contenant. Le choix est retenu par code-barres (« Transvasé dans le bidon de lessive » proposé d'office,
      « Épuisé » toujours possible). Contenant vide déclaré à la main → même proposition de liste de courses ;
      étiquette à code-barres imprimable à coller sur le contenant, pour le scanner comme un produit.
- [ ] Code-barres inconnu de la base : le saisir (nom, marque, contenance, rayon) et le garder en mémoire.
- [ ] Copie locale des produits déjà trouvés dans la base : on ne l'interroge qu'une fois par code-barres. Nom et
      contenance changent rarement ; relecture paresseuse au-delà de quelques mois, ou à la demande. Ce qu'on a
      corrigé à la main l'emporte sur la base.
- [ ] Correction d'un produit reconnu : au scan, fiche du produit (nom, marque, contenance, source et date de
      lecture) et « Ce n'est pas ça ? » → **Revérifier** (relecture immédiate de la base, différences montrées, à
      accepter ou non) ou **Corriger** (saisie à la main, notre version l'emporte).
- [ ] Versions datées d'un produit (même code-barres, contenance réduite…) : achats et prix rattachés à la version
      en vigueur à leur date, pour garder justes les prix au kilo passés.
- [ ] Relecture de la base qui contredit une correction : le signaler sans rien changer (« la base dit maintenant
      140 g, tu avais mis 150 g : garder ou passer à 140 g ? »).
- [ ] Plus tard, en option : renvoyer une correction à Open Food Facts avec le compte de l'utilisateur, seulement à
      sa demande.
- [ ] Ce que le serveur sait alors : ce qu'on a ou non, pour le « j'en ai déjà » des recettes ; inventaire
      consultable depuis le téléphone, etc.
- [ ] Le stock déjà présent à la maison s'enregistre aussi (scan ou saisie), sans prix.
- [ ] À étudier : la caméra sert déjà à reconnaître les visages (la couper pendant un scan) ; lecture des codes-barres
      dans le navigateur de Fully Kiosk ; relier un produit scanné à un ingrédient de recette (« Lardons fumés
      Herta 2×75 g » → lardons, 150 g).

### Prix (suite du stock)

- [ ] Photo du ticket de caisse (tablette, ou téléphone par la PWA ; plusieurs photos pour un long ticket), lu par
      OCR : Tesseract en local (gratuit, rien ne sort, découpage des lignes à notre charge) ou modèle de vision par
      API (bien plus fiable sur la structure : multiples, prix au kilo, remises ; l'image sort de la maison). À choisir.
- [ ] Rapprocher les lignes du ticket (libellés abrégés, sans code-barres) des produits scannés le même jour :
      marque, mots, contenance, quantités ; association confirmée retenue par enseigne, reconnue seule ensuite.
      Écran de vérification : sûres, à confirmer, sans produit (au poids, non scanné).
- [ ] Le prix est facultatif : sans ticket, ou pour le stock déjà présent, l'entrée n'a pas de prix (et les calculs
      de coût le disent : « prix connu pour 8 ingrédients sur 10 »).
- [ ] Ce qu'on en tire : historique du prix par produit, date et magasin ; coût d'une recette (notre version) et du
      menu de la semaine.
- [ ] À étudier : commandes drive (produit, prix et code-barres exacts, sans OCR) ; Open Prices (Open Food Facts),
      prix par produit et magasin, à lire et peut-être à alimenter.

## Téléphone

- [ ] Notifications (Web Push dans la PWA) : mot reçu, minuteur qui sonne, heure de partir pour le bus, tâche en
      retard. Sur iPhone, seulement si l'appli est installée sur l'écran d'accueil.

## École

- [ ] Vacances scolaires (zone B) et jours fériés, d'après le calendrier officiel : routines, devoirs et trajets
      d'école en veille pendant les vacances ; compte à rebours avant les vacances.
- [ ] Vie scolaire en lecture seule (ÉcoleDirecte, Pronote) : notes récentes, absences et retards, messages de
      l'établissement, sur le dashboard d'un parent.

## Famille

- [ ] Récompenses : points pour les routines terminées et les tâches faites, échangés contre ce que fixent les
      parents (temps d'écran, sortie…).

## Robustesse

- [ ] Sauvegarde régulière du dossier d'état (tâches, routines, visages, réglages transports) vers un dataset
      sauvegardé du NAS.
- [ ] Alerte sur le téléphone d'un parent quand une source reste en erreur plusieurs heures (dépend des
      notifications).

## Transports (après le design)

- [ ] Accueil : bloc bus compact, une ligne par arrêt avec le prochain passage par ligne, alertes en icône, tableau
      complet en touchant le bloc (maquette du 2026-11-05).
- [ ] Trajet retour, en fin de cours.
