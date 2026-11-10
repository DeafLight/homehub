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
- [ ] Pages suivantes : semaine, météo, listes, transports, téléphones, NAS, routines, puis le téléphone (PWA).
- [ ] Noms des matières sans accents (« Mathematiques ») : table de correction des libellés ÉcoleDirecte.
- [ ] Pages de réglages : bouton « Enregistré » près des modifications.

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
      « j'en ai déjà » pour les placards (sel, huile…), d'après le stock (voir « Stock de la maison ») ; on voit de
      quelles recettes vient chaque ligne. Elle rejoint la liste de courses actuelle, avec les produits hors recettes
      (lessive…).
- [ ] Secondaire, si possible : envoyer la liste au panier d'un drive (enseigne à définir, type Hyper U) depuis la
      tablette ; ce que le drive n'a pas reste dans la liste classique. HomeHub remplit le panier ; la commande et
      le paiement se valident chez l'enseigne.
- [ ] À étudier d'abord : pour chaque site visé, ce que la page d'une recette laisse lire (données structurées
      schema.org `Recipe` ?) et dans quelles conditions ; comment reconnaître un ingrédient (« 2 gros oignons
      émincés » → oignon, 2 pièces) pour l'agréger ; pour le drive, quelle enseigne a un panier accessible, et
      comment associer un ingrédient à un produit (et retenir le choix).

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
- [x] Inventaire consultable depuis le téléphone (page Stock de la PWA, `/m/stock`, 0.35.0 ; sans date ni auteur, 0.35.1).
- [ ] « J'en ai déjà » des recettes, d'après le stock.
- [ ] Plus tard, en option : renvoyer une correction à Open Food Facts avec le compte de l'utilisateur, seulement à
      sa demande.
- [ ] À étudier : relier un produit scanné à un ingrédient de recette (« Lardons fumés
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

- [x] Sauvegarde du dossier d'état (stock, listes, visages, routines, réglages transports) : `/state` est couvert par la
      sauvegarde nocturne du NAS (vérifié le 2026-11-09). Reste à tester une restauration.
- [ ] Alerte sur le téléphone d'un parent quand une source reste en erreur plusieurs heures (dépend des
      notifications).

## Transports (après le design)

- [ ] Accueil : bloc bus compact, une ligne par arrêt avec le prochain passage par ligne, alertes en icône, tableau
      complet en touchant le bloc (maquette du 2026-11-05).
- [ ] Trajet retour, en fin de cours.
