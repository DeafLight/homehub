# HomeHub

Tableau de bord familial affiché en plein écran sur la tablette (Fully Kiosk).
Hébergé sur le NAS TrueNAS, derrière Nginx Proxy Manager (accès LAN + VPN uniquement).

Captures, diagrammes d'architecture et design : [docs/](docs/README.md).

![Accueil de la tablette](docs/images/tablette-accueil.png)

- **Accueil** : grande horloge, météo, prochain événement de la famille, et « Qui est là ? » pour choisir son profil.
- **Dashboard par profil** (`/p/<id>`) : prochaine activité, tâches à cocher, semaine, mot de la famille.
  Un rail à gauche ramène à l'accueil ou passe directement à un autre profil.
- **Famille** : un profil commun (`/p/famille`) pour l'agenda partagé et la liste de courses.
- **Semaine détaillée** (`/semaine`) : ouverte depuis « Prochaine activité », « Cette semaine », les frises du jour et le
  bloc famille de l'accueil. Grille des 7 jours, agendas dans la couleur de chaque profil, cours un par un (salle,
  annulations) ; on choisit qui afficher, et on avance jusqu'à 2 semaines. Retour vers la page d'origine, comme la météo.
- **Météo détaillée** (`/meteo`) : ouverte en touchant n'importe quel affichage météo ; conditions actuelles
  (ressenti, vent, humidité, soleil), courbe des 24 prochaines heures avec la pluie, et 4 jours. Le bouton retour
  ramène à la page d'origine (`/meteo/p/<id>` quand elle est ouverte depuis un profil).
- **Scanner** (`/scanner`, bouton Scanner de l'accueil et du rail ; téléphone : bouton code-barres de l'onglet
  Courses, `/m/scanner`) : deux modes, **Ranger les courses** (entrées) et **Jeté / épuisé** (sorties). Le code-barres
  est lu par le navigateur (`BarcodeDetector`, caméra avant de la tablette, arrière du téléphone) ou tapé à la main.
  À chaque lecture : un **bip** (aigu : code lu ; puis deux notes s'il y a une question, une note grave en cas d'erreur), une vibration sur le
  téléphone, un éclair et une **bordure qui pulse** avec le bandeau « **Retire le produit** » : le scanner ne relit
  rien tant qu'un code reste devant la caméra (0,9 s sans code), si bien qu'un produit laissé devant n'est pas compté
  deux fois ; le représenter après l'avoir retiré compte un de plus. Chaque passage est listé avec **Annuler** (le
  dernier mouvement du produit), « Ce n'est pas ça ? » (fiche du produit) et, pour une sortie, « Recharge ? ». La
  reconnaissance des visages et la veille sont coupées pendant le scan ; sans activité, la tablette revient à la page
  d'origine au bout de 3 min.
  - **Qui et quand** : chaque entrée et sortie garde son heure et qui a scanné : le profil du téléphone, ou sur la
    tablette la personne reconnue en ouvrant le scanner (« Scans au nom de Léa », « Pas moi » pour scanner
    anonymement) ; personne de reconnu : anonyme. Chaque passage montre l'heure et le nom.
  - Produit **inconnu** de la base : on le décrit (nom, marque, contenance, rayon), il est gardé.
  - **Épuisé** (dernier exemplaire sorti) : « L'ajouter à la liste de courses ? » Oui / Oui, et toujours d'office /
    Non ; réglage par produit, et par défaut sur la page Stock. Un article ajouté d'office repart si on annule.
  - Sortie d'un produit **pas en stock** (entrée oubliée) : « Il en reste ? » (0 par défaut), ou « C'était une
    recharge ».
  - **Recharges** : un emballage transvasé dans un contenant de la maison (bocal à café, bidon de lessive…) sort,
    le produit reste dans le contenant ; le choix est retenu par produit (« Transvasé dans Bocal à café » proposé
    d'office, « Épuisé » toujours possible). L'étiquette du contenant (code-barres interne, préfixe 29), scannée en
    mode « Jeté / épuisé », le déclare vide.
- **Stock** (`/stock`, depuis le scanner ou la page Listes ; `/m/stock` sur le téléphone, depuis l'onglet Courses, pour
  voir au magasin ce qu'il reste, sans date ni auteur, contenants en lecture seule) : produits en stock, épuisés ou tous, recherche ; ± 1 et
  « Épuisé » à la main (pour le stock déjà là ou un oubli) ; sous chaque produit, la dernière entrée et la dernière
  sortie (« Rangé hier à 18:20 (Léa) · sorti aujourd'hui à 07:30 (anonyme) »), et pour un produit épuisé seulement
  quand et par qui (« Épuisé aujourd'hui à 07:30 (anonyme) ») ; fiche de chaque produit : historique
  des entrées et sorties (date, heure, qui, tablette ou téléphone), provenance (base et date, ou
  corrigé à la main), **Revérifier** (relecture immédiate de la base, différences montrées, à prendre ou non),
  **Corriger** (notre version l'emporte ; versions datées), liste de courses d'office ou non, contenant habituel.
  Contenants de la maison : ajout, renommage, retrait, « Vide », **étiquette à imprimer**. Écriture depuis la tablette
  (sans reconnaissance du visage : la caméra sert au scan ; au nom de la personne reconnue s'il y en a une) ou un
  téléphone relié. Prix : facultatifs, pas encore saisis (lecture des tickets à venir).
- **Recettes** (`/recettes` sur la tablette, par le bouton de l'accueil ou du bandeau des profils ; onglet Recettes
  du téléphone, `/m/recettes`) : le carnet de la famille. On partage une recette depuis son téléphone (Marmiton, Jow,
  Cookeo, ou tout site qui publie ses recettes au format schema.org) : HomeHub lit la page (titre, portions,
  ingrédients et quantités, étapes, photo, temps, mode Cookeo) et la range avec son origine ; des étapes absentes des
  données structurées sont lues dans la page (titres « Étape 1 », « Étape 2 »…) ; une page illisible propose la
  saisie à la main, lien gardé. Quand un site **refuse la lecture** par HomeHub (HTTP 403…), HomeHub ne contourne
  pas le refus : il propose de passer par le navigateur. **Coller le texte** (« Tout sélectionner », « Copier » sur
  la page, puis « Coller » dans l'import, ou partager le texte sélectionné vers HomeHub) : le menu, les publicités, les
  commentaires et « Vous aimerez aussi » sont ignorés, le titre, les portions, les temps, les ingrédients et les étapes
  sont repérés. **Page enregistrée** (Chrome : ⋮ → ⬇, puis partager le fichier `.mhtml` vers HomeHub, ou le choisir
  dans l'import) : l'archive est lue sur le serveur comme une page, photo comprise, sans aucune requête vers le site.
  Les deux donnent un **aperçu** à corriger avant d'enregistrer ; la source garde le lien s'il est connu et l'origine
  (« texte collé », « page enregistrée »). **Relire la page** reprend ce que la page donne de nouveau (des étapes manquées à
  l'import) sans écraser ce que notre version a modifié. **Notre version** se modifie (portions par défaut, ingrédients, quantités,
  étapes, astuces) et c'est elle qui sert ; la source reste visible telle que lue. Chaque ingrédient est analysé
  (quantité, unité, nom ; « 2 à 3 », « ½ », « une pincée de », « facultatif ») : les quantités suivent les portions
  choisies, la ligne d'origine est toujours gardée, et une correction à la main (**Ajuster**) l'emporte. Fiche : photo,
  temps, portions ±, ingrédients, étapes numérotées avec le mode Cookeo et un minuteur en un geste pour chaque durée
  (« 15 minutes », « 1 h 30 »). **Mode cuisine** (tablette) : une étape à la fois en grand, l'écran reste allumé, pas
  de retour à l'accueil. Ajouter : quelqu'un de reconnu sur la tablette, ou un téléphone relié ; modifier : un parent
  ou qui a ajouté la recette ; retirer : un parent. **Notes de la famille** sur la fiche (tablette et téléphone, sous
  les ingrédients) : chacun laisse une note signée et datée (« moins salé la prochaine fois », « Tom n'aime pas les
  champignons ») ; une note se marque **résolue** (repliée, toujours consultable) et se rouvre ; son auteur ou un
  parent la modifie ou la retire. Les notes ouvertes font une pastille sur les cartes du carnet et en tête de fiche, et
  s'ouvrent d'elles-mêmes dans le mode cuisine. Elles partent avec la recette quand elle est retirée.
- **Menu de la semaine** (`/menu` sur la tablette, depuis Recettes ou Listes ; `/m/menu` sur le téléphone, depuis les
  onglets Courses et Recettes) : des recettes du carnet (notre version), chacune pour un nombre de personnes (par défaut
  ses portions) et un jour, ou « dans la semaine » ; une recette peut revenir plusieurs fois. Semaines suivantes
  préparées à l'avance (4 au plus), semaines passées en lecture (12 gardées). Modifier : un parent ; les enfants le
  voient. La croix d'une ligne retire le repas, « Annuler » le rend pendant 6 secondes. **Courses du menu** : les
  ingrédients mis à l'échelle des personnes, regroupés par ingrédient (unités converties : g / kg, ml / cl / l, c. à c.
  / c. à s., pièces ; des unités qui ne se comparent pas restent côte à côte, « 2 + 100 g »), rangés par rayon, avec les
  recettes d'où ils viennent. Ils rejoignent la liste de courses, marqués d'un livre : une ligne du menu suit le menu
  (mise à jour, retirée quand il n'y a plus rien à acheter), une ligne cochée ou vidée compte comme achetée et n'est
  jamais touchée (seul le complément revient, sur une nouvelle ligne), une ligne ajoutée à la main pour le même
  ingrédient l'emporte, et retirer une ligne du menu vaut « j'en ai déjà » pour la semaine. **J'en ai déjà** : les
  placards (sel, poivre, huile, eau ; liste modifiable) ne sont jamais demandés ; « J'en ai déjà » se coche par
  ingrédient et par semaine ; d'après le **stock**, un produit relié à un ingrédient (deviné par les mots du nom et la
  contenance, confirmé une fois puis retenu par produit, « Changer », « Pas un ingrédient ») retire la ligne quand il y
  en a assez (« en stock (1 kg) »), ne demande que la différence sinon, et le signale sans trancher quand les unités ne
  se comparent pas (« 1 oignon » contre « 1 kg »). Un produit qui **s'utilise en plusieurs fois** (gruyère, farine,
  beurre : deviné quand un paquet couvre plus que le plus grand besoin d'une recette du carnet, réglable dans « Stock
  et ingrédients ») a peut-être un paquet entamé : seuls les autres paquets comptent sûrs. S'ils ne suffisent pas mais
  que le paquet entamé, plein, comblerait le manque, l'ingrédient est **« À vérifier au placard »** : « J'en ai assez »
  le retire des courses pour la semaine, « Il en faut » l'y garde ; sans décision, il reste sur la liste de courses,
  marqué « à vérifier : paquet peut-être entamé » (en cas de doute, on achète). **Arrondi au paquet** : quand un
  produit est relié et que les unités se comparent, la ligne dit combien de paquets acheter (« 250 g (2 × 200 g) »),
  dans les courses du menu comme sur la liste. Le stock n'est jamais décompté quand on cuisine.

- **Le NAS** (`/nas`) : ouvert par la roue dentée ou en touchant la version de HomeHub sur l'accueil ; état général, processeur,
  mémoire, données et batterie, points à surveiller (contrôles de santé du NAS, sources de HomeHub en erreur,
  points faibles du matériel), services et événements récents (sauvegarde, vérification des données, démarrages).
- **Listes** (`/listes`) : courses et tâches de la famille, ouvertes depuis « Mes tâches » ou « Liste de courses ».
  Courses : saisie rapide, articles fréquents en un geste, articles cochés « dans le panier » jusqu'à « Vider » ;
  à acheter rangé par rayon, les lignes du menu de la semaine marquées avec leurs recettes.
  **Drive** (bouton « Drive » des courses, tablette et téléphone) : un parent choisit l'enseigne (Courses U pour
  l'instant) et le magasin de retrait (un nom, et si on veut le lien de sa page). Ensuite, le chariot de chaque article
  ouvre « Produit chez Courses U » : on colle le lien de la fiche du produit, ou on la **partage** depuis le site ou
  l'appli de l'enseigne vers HomeHub (« Relier à un article de la liste »). L'identifiant vient du lien ; la fiche est
  lue **une fois, quand on touche « Lire la fiche »** (JSON-LD `Product` : nom, contenance, code-barres), à corriger
  avant de retenir. Si le site refuse la lecture (anti-robots), rien n'est contourné : on saisit le nom et la contenance,
  ou on les reprend d'un produit du stock (« Au stock : … », avec son code-barres) ; un code-barres connu au stock est
  comparé à celui de la fiche. Le choix est **retenu** par article et par enseigne (« gruyère » → tel paquet), avec des
  produits de secours (trois au plus) qui ne sont jamais pris d'office ; tout se change ou se retire. Sous l'article,
  le produit retenu et, pour une ligne du menu dont la contenance est connue, le nombre de paquets (même arrondi que la
  liste : « 1 × 200 g pour 160 g »). HomeHub ne cherche jamais dans le catalogue de l'enseigne, ne voit ni compte, ni
  créneau, ni paiement : le panier se remplit dans l'appli de l'enseigne, à la main ou avec l'extension (`drive.json`).
  **Remplir le panier** (bouton des courses, ou des réglages du drive) : les articles à acheter dans l'ordre des rayons,
  chacun avec son produit retenu, le **nombre de paquets** et un bouton « Fiche » qui ouvre le produit chez l'enseigne ;
  on remplit le panier dans l'appli de l'enseigne et on **coche** ici (panier en cours gardé par le serveur, partagé
  entre la tablette et les téléphones ; « Nouveau panier » retire toutes les coches). Article compté en pièces et
  paquet d'une autre contenance (« 5 oignons » contre un filet de 1 kg) : HomeHub demande une fois **« Combien de
  pièces dans ce paquet ? »**, le retient sur le produit et calcule les paquets ; contenance inconnue, produit au poids
  ou autre grandeur : 1 paquet, signalé « à vérifier ». **Récapitulatif** : ce qui part au drive (produits et
  paquets), ce qui reste à mettre au panier, ce qui s'achète ailleurs (aucun produit retenu, ou seulement des
  secours), avec les prix vus par l'extension et leur **total indicatif**. Un article coché passe dans le groupe
  **« Au drive »** de la liste de courses, sans être coché comme acheté ; « Reçu : tout cocher » le fait une fois le
  panier retiré, et le décocher dans « Remplir le panier » le remet dans les rayons. Un article qui quitte la liste
  quitte aussi le panier.
  **Extension « Remplir le panier »** (Courses U, sur ordinateur ; voir la section « Extension » plus bas) :
  l'onglet « Extension » de Remplir le panier **copie le panier** (« Copier pour l'extension » : les articles qui ont
  un produit retenu et ne sont pas encore cochés, en petit JSON) ; dans le navigateur, sur le site de l'enseigne
  ouvert et connecté au compte de la personne, l'extension ajoute ces produits **un par un, en cliquant le bouton
  « Ajouter » de chaque fiche**, à rythme humain, et **s'arrête au premier captcha, refus ou page inattendue**. Son
  **compte rendu**, recollé dans le même onglet, coche les articles partis « au drive » et note sur chaque produit
  le prix et le code-barres lus dans la page.
  Tâches : pour qui, échéance (en retard en rouge), répétition (la suivante est créée quand on coche), filtre par
  personne ; une tâche faite reste visible jusqu'à minuit. Les tâches d'un membre apparaissent sur son dashboard, les
  courses sur celui de la famille. Sur la tablette, ce qui est coché ou ajouté l'est au nom de la personne reconnue.
- **Mots** : envoyés depuis un profil à un autre, ou à toute la famille (200 caractères) : depuis son téléphone
  (onglet Mots) ou la tablette (bloc « Mots » d'un dashboard, envoyé depuis ce profil ; on choisit seulement à qui). Le
  destinataire le voit sur son dashboard et son téléphone, touche « Vu » et il disparaît ; sinon il s'efface au bout
  de 7 jours (`notes.json`).
- **Téléphones** (`/telephones`, par la roue dentée de la tablette) : on choisit le profil, le téléphone scanne le QR code
  (valable 5 min, une seule fois) et devient l'appli de ce profil : `/m` (courses), `/m/taches` (avec, en tête, la
  routine du moment à cocher ; pastille sur l'onglet : étapes restantes), `/m/agenda`
  (7 prochains jours, soi et la famille), `/m/mots`, `/m/recettes`, `/m/menu`. Installable sur l'écran d'accueil (PWA) ; « Partager » depuis une autre appli
  ouvre l'ajout prérempli (`/partager`) ; un lien partagé ouvre l'import de recette (ou, au choix, l'ajout à une liste) ;
  un texte copié d'une recette ou une page enregistrée (`.mhtml`), l'aperçu de l'import ; le lien d'une fiche produit
  du drive (Courses U), le choix de l'article de la liste auquel le relier. Un téléphone retiré depuis la tablette perd l'accès aussitôt.
  La tablette affiche le modèle annoncé par le téléphone, rendu lisible (« SM-S918B » → « Samsung Galaxy S23 Ultra »),
  et son système ; on le renomme en touchant son nom.
  Un profil peut avoir un **code PIN**, demandé par la tablette avant d'afficher son QR code et avant de retirer un
  de ses téléphones (5 erreurs : bloqué 15 min). Un **code parent** retire n'importe quel téléphone. On les définit
  sur le serveur : `node scripts/set-pin.ts <profil>` ou `--parent` (dans le conteneur :
  `docker exec -it homehub node scripts/set-pin.ts <profil>`, `--supprimer` pour l'enlever, sans argument : la liste).
  Sans aucun code défini, le retrait se confirme d'un second geste.
- **Qui écrit** (tablette) : tout le monde lit tous les profils. La caméra reconnaît en continu, sans rien demander,
  la personne devant la tablette (environ une analyse par seconde tant que l'écran est allumé ; deux analyses de
  suite sur la même personne pour la retenir ; oubliée après 10 s sans être vue). Elle s'affiche en bas du rail des
  dashboards et à côté de la roue dentée de l'accueil (« Personne » si la caméra tourne sans reconnaître personne), et
  son profil ressort sur l'accueil. Un geste qui modifie (cocher, ajouter, laisser un mot, « Vu », relier, renommer ou
  retirer un téléphone) passe tout de suite si elle en a le droit ; si personne n'est encore reconnu, une petite bulle
  « Regarde la tablette » l'attend quelques secondes. Un **parent** (`parent: true` dans la configuration) modifie
  tous les profils, famille comprise ; un enfant, seulement le sien (ni la liste de courses, ni le profil de la
  famille, ni « Vu » sur un mot à toute la famille) : sinon, « Lecture seule : profil de … ». Même règle pour les
  téléphones, chacun au nom de son profil. Les visages s'enregistrent par la roue dentée (**Visages**, `/visages`) :
  10 prises guidées (« approche-toi », « recule un peu »), à faire à sa place habituelle, puis le code parent
  (obligatoire). La tablette ne calcule qu'une empreinte du visage (bibliothèque
  [Human](https://github.com/vladmandic/human), modèles servis par HomeHub) ; le serveur la compare aux empreintes
  enregistrées (`faces.json`) et ouvre une session courte. Aucune image ne quitte la tablette. Lors d'une
  reconnaissance sûre et assez différente des empreintes connues, le serveur en **apprend** une (au plus une par
  personne toutes les 30 min, `faces.learnMinutes` ; 10 gardées, en plus des 20 enregistrées au plus) : la
  reconnaissance suit les changements de coiffure, de lunettes ou de lumière. Le **diagnostic** (page Visages) montre
  en direct la confiance de détection, la taille du visage, les scores « photo » et « écran », la ressemblance avec
  chaque personne et le verdict, avec les seuils en vigueur et le moteur de calcul, puis un bilan des dernières analyses
  et une piste de réglage. Des prises presque identiques entre elles (tablette qui donne la même empreinte à tous les
  visages, vu après une mise à jour d'Android System WebView) ne sont pas enregistrées, et un profil déjà touché est
  signalé « prises anormales » : l'effacer et le refaire une fois le calcul réparé. Le calcul passe par la carte
  graphique (`faces.backend: webgl`) ; `webgl-safe` la garde sans les optimisations de TensorFlow.js qui faussent les
  résultats sur certaines tablettes, `cpu` s'en passe (plus lent, toujours juste). Limites : la tablette
  est de confiance (sa clé suffit à se faire passer pour elle) ; les contrôles « photo » et « écran » réduisent, sans
  l'exclure, la ruse d'une photo ; la caméra reste allumée tant que l'écran l'est (éteinte sur la page Visages, et
  quand la page est masquée). Fully Kiosk : activer *Web Content Settings › Enable Webcam Access* et autoriser la
  caméra à Fully dans Android ; la détection de mouvement de Fully se sert aussi de la caméra et peut l'empêcher.
- **Veille** (tablette) : après 5 min sans contact ni visage devant la caméra (`ui.screensaverMinutes`, 0 : jamais),
  écran noir où seuls restent l'horloge, la date et la météo du moment (température, ciel, min et max ou pluie à
  venir ; le lendemain en soirée), déplacés au hasard toutes les 12 s (pour ne pas marquer l'écran) ; avec
  l'interface JavaScript de Fully Kiosk, la luminosité baisse aussi. Un visage devant la caméra ou un contact la
  réveille ; le contact qui réveille n'ouvre ni ne coche rien.
- **Accueil personnalisé** (tablette) : la personne reconnue a sa carte sur l'accueil (« Bonsoir Léa ! ») : ses mots
  pas encore vus (en évidence, qui clignotent doucement), sa routine du moment, ses devoirs du prochain jour
  (« 3 devoirs pour demain »), ses premières tâches et son prochain rendez-vous ; la toucher ouvre son dashboard. Chaque profil de « Qui est là ? » montre aussi le nombre de ses mots
  pas encore vus, et l'indicateur de la personne reconnue (accueil et rail) le sien, à toucher pour ouvrir son
  dashboard.
- **Routines** du matin et du soir : étapes propres à chaque membre, affichées sur son dashboard à leurs heures (5 h–11 h
  et 17 h–23 h par défaut, d'autres possibles le week-end) à la place de « À venir ». Une étape peut ne valoir que
  certains jours ; un jour sans étape prévue n'affiche pas de routine et ne casse pas la série. Elles sont cochées
  comme ses tâches (mêmes droits) et remises à zéro chaque jour (`routines.json`). Avancement sur l'accueil ;
  « Bravo, c'est fini ! » et le nombre de jours de suite où la routine a été faite en entier.
- **Page Routines** (roue dentée de la tablette) : les étapes de chacun et les heures, réglées au doigt : un membre à
  la fois, matin et soir côte à côte ; pour chaque étape, son nom, ses jours (L M M J V S D, tous allumés : tous les
  jours), monter ou descendre, supprimer ; « Nouvelle étape » ; heures en semaine et, au besoin, le week-end. Tout le
  monde peut regarder ; seul un parent reconnu (ou un téléphone de parent) enregistre (`routine-plans.json`). Chaque
  étape garde un identifiant : la renommer ou la déplacer ne perd ni ses cases du jour ni les jours de suite.
- **Enregistrement automatique des réglages** (pages Routines, Transports, Vacances scolaires) : pas de bouton
  « Enregistrer », chaque modification part d'elle-même un instant après (la saisie finie, les clics enchaînés). Son
  état s'affiche à côté de ce qu'on vient de modifier, dans le titre de la carte : « Enregistrement… », « Enregistré »,
  ou le problème (étape sans nom, « Seul un parent peut modifier ») avec « Annuler » pour revenir à ce qui est
  enregistré. Sur la tablette, le premier enregistrement attend qu'un parent soit reconnu.
- **Dashboard d'un élève** (profil avec emploi du temps), dit « focus » : une seule frise avec la bascule « Aujourd'hui | Demain » (demain d'office une fois la journée de cours finie), la carte du
  moment en grand (routine du matin ; après l'école, les devoirs qui restent jusqu'à 19 h ; puis la routine du soir ;
  sinon les rendez-vous), et le reste en tuiles (devoirs, routine, tâches, mots, prochain rendez-vous) : un chiffre
  et un mot, bordées de la couleur du profil quand il y a du nouveau (mot, devoirs pour demain). Une tuile ouvre sa
  carte complète dans un panneau, refermé d'un toucher à côté ou seul après 30 s.
- **Devoirs** (élève avec ÉcoleDirecte ou Pronote) : carte « Devoirs » sur son dashboard, à la place de « À venir » :
  par jour (« Pour demain », « Pour lundi » ; ceux du jour le matin seulement), matière (accents remis aux noms
  qu'ÉcoleDirecte donne en capitales : « Mathématiques », « Français » ; sigles gardés : « EPS »), consigne (toucher pour la
  lire en entier), « Contrôle » quand ÉcoleDirecte l'annonce, pièces jointes et durée prévue s'il y en a. Aussi dans
  l'onglet Tâches de son téléphone. **Lecture seule** : un devoir se coche dans l'appli de l'école ; HomeHub montre
  « ✓ fait » au rafraîchissement suivant.
- **Vie scolaire** (enfants avec ÉcoleDirecte ou Pronote), **pour les parents seulement** : sur le dashboard d'un
  parent reconnu devant la tablette, un bloc « Vie scolaire » en tête de la colonne du milieu donne, par enfant, sa
  dernière note, ses absences et retards (« 1 à justifier » en jaune), puis les messages non lus de l'établissement.
  Le toucher ouvre le détail : notes récentes (barème, coefficient, moyenne de la classe), absences et retards avec
  leur motif, objets des messages reçus. Même carte en tête de l'onglet Agenda du téléphone d'un parent. **Lecture
  seule** : HomeHub ne lit que la liste des messages, jamais leur contenu (l'ouvrir les marquerait lus) ; on les lit
  dans l'appli de l'école. Ni l'accueil, ni le dashboard d'un enfant, ni la tablette sans parent reconnu n'en montrent
  rien : le serveur la refuse.
- **Bus et tram Irigo** (Angers) : sur l'accueil, les prochains passages aux arrêts suivis (`transit.stops`), deux
  par ligne et direction, avec une antenne verte quand l'heure vient du temps réel, et les perturbations de ces
  lignes ; sous l'horloge de la veille, ceux du premier arrêt. Trajet du matin d'un membre (`commute`) : à ses heures
  et ses jours, un bandeau en haut de son dashboard dit quand partir de la maison, marche comprise (« Pars dans
  6 min pour le bus 3 de 07:42 », orange la dernière minute, puis le suivant ou « Trop tard »).
- **Vacances scolaires** (page « Vacances scolaires » de la roue dentée, sinon `holidays` du YAML : l'académie, ou
  la zone A, B ou C) : calendrier officiel du ministère
  (data.education.gouv.fr, sans clé), relu au plus une fois par jour et gardé dans `school-holidays.json` (une panne
  laisse le dernier reçu). Une puce discrète sous l'horloge de l'accueil, dans l'en-tête des dashboards et en tête de
  l'agenda du téléphone : « Vacances de Noël dans 12 jours » (3 semaines avant au plus), « Dernier jour avant les
  vacances de Noël », puis « Vacances de Noël · reprise lundi 4 janvier ». Pendant les vacances : pas de trajet du
  matin, pas de cours (frise, prochain cours de l'accueil, semaine) ni de devoirs pour ces jours-là ; les routines
  prennent les heures du week-end et laissent de côté les étapes des jours d'école (celles prévues certains jours de
  semaine seulement, comme « Cartable » du lundi au vendredi). Vacances des élèves (pas celles des enseignants) ; Corse
  et outre-mer par leur académie.
- **Jours fériés** (France métropolitaine, calculés sur place, sans réseau ni réglage : dates fixes, plus lundi de
  Pâques, Ascension et lundi de Pentecôte) : traités comme un jour de vacances pour l'école (ni trajet du matin, ni
  cours, ni devoirs pour ce jour-là, routines aux heures du week-end sans les étapes des jours d'école). La même puce
  dit « Férié · 11 novembre » le jour même, et la veille d'un jour de classe férié « Demain férié · Ascension »
  (« Lundi férié · lundi de Pâques » le vendredi) ; rien pendant les vacances, qui l'emportent. Pas les jours propres à
  l'Alsace-Moselle ni à l'outre-mer.
- **Page « Vacances scolaires »** (roue dentée de la tablette ; un parent enregistre) : « Par académie » (liste
  regroupée par zone, Corse et outre-mer à part, filtrée par la saisie sans accents ni majuscules), « Par zone »
  (A, B ou C) ou « Aucune ». Un aperçu montre les prochaines vacances du choix. Enregistré dans
  `HOMEHUB_STATE_DIR/holiday-settings.json`, qui prend le pas sur la section `holidays` du YAML ; sans rien
  d'enregistré ni de section `holidays`, la page s'ouvre sur « Aucune ».
- **Page « Transports »** (roue dentée de la tablette ; un parent enregistre) : les lieux de la famille (maison,
  école, club…), situés par leur adresse ; le trajet de chacun, avec les lignes directes entre les deux lieux trouvées
  dans les horaires Irigo (marche estimée aux deux bouts, modifiable) ; les arrêts de l'accueil (par nom ou près d'un
  lieu). Un trajet **selon l'emploi du temps** prend chaque jour la dernière course qui fait arriver avant le premier
  cours non annulé (marge réglable), affiche le bandeau un moment avant l'heure de partir et reconnaît cette course
  dans le temps réel (« annoncé à 07:53 », supprimée, manquée) ; rien les jours sans cours. Sinon, plage horaire
  fixe. Tant que la page n'a pas été enregistrée, `transit.stops` et `commute` du YAML s'appliquent.
- **Sport** (téléphone, onglet Sport, `/m/sport` ; adulte avec `fitness: true` dans homehub.yaml) : programme de
  renforcement au poids du corps, trois séances qui tournent sans jour fixe, six exercices chacune (cardio, jambes,
  poussée, fessiers ou une jambe, dos, gainage), trois paliers (Base 3 tours, Volume 4, Intensité 4). Rythme de départ
  30 s d'effort / 30 s de repos. En fin de séance : ressenti global (1 à 5), puis par exercice difficulté (facile, ça
  va, dur), gêne et où (genoux, épaules, dos, poignets), répétitions et note, tous facultatifs. Bilan de la semaine,
  une fois finie (le lundi, et toute la semaine suivante) : une bonne semaine (2 séances ou plus, aucune au-delà de
  « exigeant », comme la série des statistiques), il propose +5 s d'effort ; deux séances à 5 ou une arrêtée, −5 s ;
  au choix à même durée (le repos compense) ou séance plus longue / plus courte, durée affichée, et toujours « garder
  ce rythme » (effort 20–60 s, repos 10–40 s). Le bilan attend la fin de la semaine : une 3e séance dure compte encore.
  À partir de 45 s d'effort, une bonne semaine propose le palier suivant, avec 10 s d'effort en moins, en deux temps :
  jambes, dos et gainage passent tout de suite à la version du palier (« nouveau au palier » dans la séance, avec
  l'exercice d'avant, jusqu'à ce qu'elle soit faite), cardio, poussée et une jambe gardent la leur jusqu'à la bonne
  semaine suivante, dont le bilan propose alors « finir le palier » au même rythme. Exercices d'un côté puis de
  l'autre : on change de côté à la moitié de l'effort. Réglages du programme (bas de l'onglet) : **élastique de
  tirage** (fixé à une porte ; l'exercice de dos de chaque séance devient un rowing à l'élastique, deux bras, avec
  pause, puis un bras ; même durée de séance, six exercices) et **sans sauts** (chaque exercice qui saute, marqué dans
  le catalogue, laisse la place dès le départ à sa version sans impact, signalée « à la place de »). Par exercice, jamais d'office : « dur » deux fois, la version plus
  facile ; « facile » deux fois, la plus difficile ; une gêne, un remplaçant doux. Cardio et tour de taille de la
  semaine, courbe du tour de taille, historique. Catalogue des exercices : animation de chaque exercice (bonhomme dessiné
  par HomeHub, 2 à 4 positions en boucle, pause et ralenti, à l'arrêt si le téléphone demande moins d'animations),
  vignette dans les listes, position, mouvement, respiration, muscles sur une silhouette face et dos (principaux en
  plein, les autres en clair), erreurs fréquentes, versions voisines. Données personnelles (`fitness.json`) : seul le téléphone de la personne les
  lit, ni la tablette ni les autres téléphones. Statistiques (lien sous l'historique), calculées sur ce qui est déjà
  noté : séances (dont arrêtées), temps d'entraînement estimé, semaines régulières d'affilée (2 séances ou plus) et
  record, meilleure semaine ; sur les 12 dernières semaines, séances et cardio par semaine, temps d'effort avec les
  changements de palier, ressenti moyen ; par exercice, fois au programme, répétitions (ou secondes) notées, « dur »,
  « facile » et gênes ; jours de séance ; tour de taille sur 4 semaines et depuis le début ; tout l'historique par mois.
- **Sport sur la tablette** (bouton « Sport » dans l'en-tête du dashboard d'un profil qui a un programme, affiché seulement quand cette personne
  est reconnue devant la tablette, `/sport`) :
  séance du jour de la personne reconnue devant la tablette, elle seule (pas un parent pour un autre), sans rien de
  personnel (ni notes, ni historique, ni tour de taille), et catalogue des exercices. Séance guidée (`/seance`) :
  échauffement de 5 min (cinq mouvements doux d'une minute), puis chaque effort avec son compte à rebours et son
  animation, au repos l'exercice suivant, 1 min de pause de plus entre les tours ; bips aux trois dernières secondes,
  au départ et à la fin de chaque effort ; pour un exercice d'un côté puis de l'autre, trois notes qui montent à la
  moitié de l'effort et « Change de côté ! » en grand ; pause, passer, arrêter. À la fin (ou à l'arrêt), le ressenti (1 à 5) est
  noté dans le programme, et la séance suivante vient ; le détail par exercice se note sur le téléphone. Pendant la
  séance, la tablette reste sur le profil : ni fin de la session de la personne reconnue (`faces.sessionMinutes`,
  prolongée en continu), ni retour à l'accueil (`ui.idleTimeoutSeconds`), ni veille (`ui.screensaverMinutes`), même
  loin de la caméra ; en sortant, tout reprend, délais repartis de zéro.
- **Minuteurs** (tablette) : bouton minuteur sur l'accueil et dans le rail. La durée se choisit sur une roue (glisser
  le doigt autour du cadran : un tour, une heure, autant de tours qu'on veut jusqu'à 24 h ; − 1, + 1, + 5, + 1 h ;
  raccourcis jusqu'à 2 h qui font tourner la roue) qui montre l'heure de
  fin ; l'activité, facultative (🍝 Cuisson, 📺 Écrans, 📚 Devoirs, 🦷 Dents, 🚿 Douche, 🎲 Jeux), donne son emoji et
  sa couleur à la roue, aux pastilles et à l'alerte ; puis « Lancer ». En cours, ils restent en bas de l'écran, avec un
  anneau qui se vide (et sous l'horloge de la veille) ; à la fin, ils
  prennent tout l'écran, réveillent la tablette et sonnent (trois bips répétés, 2 min au plus) jusqu'à « Arrêter ».
  Lancer ou annuler un minuteur demande quelqu'un de reconnu (n'importe qui, enfant compris) ; arrêter celui qui
  sonne, non. Enregistrés (`timers.json`) : une mise à jour ou un redémarrage du serveur ne les perd pas ; celui qui
  s'est terminé entre-temps sonne au retour.
- Retour automatique à l'accueil après un délai sans contact ; rechargement automatique après un déploiement
  ou une modification de la configuration. La version chargée est affichée sous l'horloge de l'accueil.

La **météo** vient d'[Open-Meteo](https://open-meteo.com) avec les modèles de Météo-France (AROME 1,3 km, ARPEGE) :
gratuit, sans clé, mis en cache 15 min ; en cas de panne, la dernière prévision reste affichée jusqu'à 6 h, puis le
bloc est masqué.

L'**agenda** vient des adresses secrètes iCal (Google Agenda ou autre), téléchargées toutes les 10 min ; les
récurrences, exceptions, fuseaux horaires et événements sur la journée sont gérés (`ical.js`). Les adresses sont des
secrets : le YAML ne contient que le nom de la variable d'environnement qui les porte. Tant qu'aucun agenda n'est
configuré, l'agenda affiche des exemples.

L'**emploi du temps** vient d'ÉcoleDirecte (API privée du site, non officielle : elle peut changer), rafraîchi
toutes les 60 min. Un profil avec `ecoledirecte: <prénom de l'élève>` affiche une frise du jour ou de demain (cours en
gris, agenda à sa couleur). La connexion demande, la première fois, de répondre à une question
de sécurité : `node scripts/ecoledirecte-pair.ts [prénom]` le fait sur un PC et affiche les variables
`ECOLEDIRECTE_IDENTIFIANT`, `ECOLEDIRECTE_MOTDEPASSE`, `ECOLEDIRECTE_CN`, `ECOLEDIRECTE_CV` à mettre dans
l'environnement.

Les **devoirs** viennent de la même connexion (cahier de texte ÉcoleDirecte, devoirs Pronote), sur la même fenêtre
de trois semaines et au même rythme. Si l'établissement n'ouvre pas le cahier de texte au compte Famille, les cours
restent affichés, sans carte « Devoirs », et l'erreur est notée dans les journaux.

La **vie scolaire** aussi, au même rythme : notes et absences et retards de chaque enfant, liste des messages reçus
par le compte (ÉcoleDirecte : carnet de notes, vie scolaire et messagerie du compte Famille ; Pronote : notes et
carnet de la période en cours, l'année si l'établissement la propose, et discussions de la messagerie). Chaque
rubrique fermée au compte manque seule, notée dans les journaux. Les formats ÉcoleDirecte viennent de la
documentation communautaire de l'API (non officielle) : à vérifier dans les journaux au premier déploiement.

Il peut aussi venir de **Pronote** (compte parent), avec `pronote: <prénom de l'enfant>` sur le profil, par
[Pawnote](https://github.com/LiterateInk/Pawnote), bibliothèque non officielle qui imite l'application mobile.
Pawnote 1.6.2 ne suit pas Pronote 2026 : `scripts/patch-pawnote.ts` le corrige à chaque `npm install` et fait
échouer l'installation si la version change. La connexion se fait par jeton, comme l'application :
1. dans Pronote, bouton « QR code de l'application » en haut de la page, choisir un code PIN, faire une capture
   d'écran du QR code (valable 10 min) ;
2. sur un PC : `node scripts/pronote-pair.ts <capture.png> [prénom]` (demande le PIN, vérifie l'emploi du temps,
   écrit `~/.homehub-pronote.json`) ;
3. copier ce fichier sous le nom `pronote.json` dans le dossier d'état (`HOMEHUB_STATE_DIR`), inscriptible par
   l'app.

Pronote donne un nouveau jeton à chaque connexion : HomeHub le réenregistre aussitôt dans `pronote.json`. Le
fichier copié ne sert donc qu'une fois ; s'il est perdu ou refusé, refaire l'appairage. L'appareil apparaît dans
la liste des appareils connectés du compte Pronote, d'où il peut être révoqué.

Les **bus et trams** viennent de l'open data d'Angers Loire Métropole (licence ODbL, sans compte ni clé) : prochains
passages par l'API SIRI d'Ara (`StopMonitoring`, en tant que `opendata`), au plus une fois par minute et par arrêt,
et seulement quand un écran les demande ; perturbations par le flux GTFS-RT d'alertes, toutes les 10 min. SIRI ne
connaît que les courses de l'heure qui vient : la nuit, un arrêt n'affiche aucun passage. Pour trouver
l'identifiant d'un arrêt (un par sens) : `node scripts/irigo-stops.ts <nom>`, puis
`node scripts/irigo-stops.ts --passages <id>` pour voir ses destinations.

La page « Transports » s'appuie aussi sur les **horaires théoriques** (GTFS du même jeu, sur transport.data.gouv.fr) :
position des arrêts, lignes, courses de chaque jour. L'archive (5 Mo) est téléchargée au plus une fois par semaine et
gardée dans `HOMEHUB_STATE_DIR/irigo-gtfs.zip` (lien data.gouv.fr, redirigé vers `chouette.enroute.mobi`). Les adresses
sont cherchées sur la Géoplateforme de l'IGN (`data.geopf.fr`, successeur de l'API Adresse) : seule l'adresse tapée
lui est envoyée. Lieux et trajets sont enregistrés dans `HOMEHUB_STATE_DIR/transit-settings.json`, jamais dans le
dépôt. Pas de correspondance : seules les lignes directes sont proposées (arrêts à moins de 800 m de chaque lieu ;
marche estimée : ligne droite + 30 %, à 4,5 km/h).

Les **produits** viennent des bases libres [Open Food Facts](https://world.openfoodfacts.org), puis Open Beauty Facts
(hygiène) et Open Products Facts (lessive, entretien…) : sans compte, avec un User-Agent qui nomme HomeHub ; seul le
code-barres leur est envoyé. Chaque produit trouvé est copié dans `stock.json` : la base n'est relue qu'au scan d'un
produit lu il y a plus de 180 jours, ou sur « Revérifier ». Ce qui a été corrigé à la main l'emporte : une relecture
qui le contredit est signalée sur la fiche (garder la nôtre ou prendre la base), jamais appliquée d'office.

Les **recettes** sont lues sur la page partagée, chez son site : une seule demande (et une pour la photo), avec un
User-Agent qui nomme HomeHub, seulement quand quelqu'un importe. Le serveur refuse les adresses locales ou privées
(et après chaque redirection), au-delà de 3 Mo ou de 10 s ; seuls `http` et `https` passent. La recette et sa photo
sont ensuite copiées dans `recipes.json` et `recipes/` : le site n'est plus jamais relu. Le carnet est privé à la
maison ; certains sites interdisent l'extraction systématique de leurs recettes, HomeHub ne lit que la page partagée.
Un site qui refuse la lecture (401, 403, 429, 451) n'est pas relancé autrement (ni faux User-Agent, ni navigateur
automatique) : le texte copié ou la page enregistrée viennent du navigateur de la personne. Une page enregistrée
(25 Mo au plus) n'est que découpée et décodée, rien n'y est exécuté ni suivi. Partagée depuis Chrome, elle arrive par
`POST /partager` sans le jeton du téléphone : elle attend au plus 10 minutes en mémoire (3 places, numéro tiré au
hasard) que l'appli la réclame, droits vérifiés. Après la mise à jour, Android peut mettre un moment à proposer
HomeHub pour les fichiers (le manifeste de l'appli installée est relu de temps en temps).

Sans agenda configuré, l'agenda est d'exemple (`server/sources/sample.ts`) ; les tâches et les mots sont toujours
réels.

## Extension « Remplir le panier »

Une extension de navigateur (Manifest V3, dossier `extension/`) qui remplit le panier **Courses U** depuis le
navigateur et le compte de la personne, à partir du panier préparé par HomeHub. Étape 3 du drive, voir
[l'étude](docs/etude-drive.md) pour le pourquoi et les règles.

**Ce qu'elle fait** : on y colle le panier copié depuis HomeHub (Remplir le panier → Extension → « Copier pour
l'extension ») ; sur l'onglet ouvert sur www.coursesu.com, connecté, magasin choisi, « Remplir le panier » ouvre chaque
fiche à son tour, clique « Ajouter » puis « + » jusqu'au nombre de paquets, en attendant chaque fois que le site
confirme (quantité de la fiche ou compteur du panier), puis passe à la fiche suivante après une pause fixe (1,5 s
entre deux clics, 4 s entre deux produits). Un bandeau en bas de la page dit où elle en est, avec « Arrêter ». Un
produit déjà au panier en quantité suffisante n'est pas rajouté ; un produit indisponible est passé et signalé. À
la fin, le panneau de l'extension liste ce qui est parti et propose « Copier le compte rendu » (identifiant, paquets,
EAN et prix lus dans la page), à recoller dans HomeHub pour cocher les lignes et noter les prix.

**Quand elle s'arrête** : au premier captcha ou vérification anti-robots, page de refus, page de connexion, fiche
qui n'est pas celle attendue, bouton « Ajouter » absent ou ajout que le site ne confirme pas dans les 10 s. Elle le
dit dans le bandeau et le panneau ; la personne finit à la main (« Reprendre » repart de la fiche en cause, à sa
demande seulement).

**Ce qu'elle ne fait jamais** : résoudre ou éviter un captcha, changer d'adresse ou d'en-têtes, accélérer, appeler
les points d'entrée internes ou « partenaire » du site, tourner sans la personne ou ailleurs que dans son onglet,
réserver un créneau, payer. Elle ne lit ni ne garde aucun mot de passe ni jeton de l'enseigne ; elle ne garde que le
panier en cours, dans le stockage local du navigateur. Elle n'a accès qu'au site coursesu.com et ne suit que des
liens de fiches produit de l'enseigne (un panier collé avec un autre lien est refusé en entier). Elle ne parle pas à
HomeHub : tout passe par copier-coller.

**Installer** (hors boutique, mode développeur) :

```bash
npm run build:extension   # construit extension/dist
```

- **Chrome ou Edge** : `chrome://extensions` (ou `edge://extensions`), activer le **mode développeur**, « Charger
  l'extension non empaquetée », choisir `extension/dist`. Elle reste installée ; après une nouvelle version, refaire
  `npm run build:extension` puis « Actualiser » sur sa carte.
- **Firefox** : `about:debugging#/runtime/this-firefox`, « Charger un module complémentaire temporaire… », choisir
  `extension/dist/manifest.json`. Firefox l'enlève à sa fermeture ; à la première utilisation il demande l'accès à
  coursesu.com. Une installation durable (et **Firefox Android**) demande une extension signée par Mozilla
  (publication non listée sur addons.mozilla.org), pas encore faite.

**Utiliser** : dans HomeHub (téléphone relié, ou ordinateur relié comme un téléphone pour pouvoir recoller le compte
rendu), Courses → Remplir le panier → Extension → « Copier pour l'extension ». Sur l'ordinateur, ouvrir
www.coursesu.com, se connecter, choisir le magasin ; bouton de l'extension → coller → « Lire le panier » → « Remplir
le panier ». À la fin (ou à l'arrêt), vérifier le panier sur le site, puis « Copier le compte rendu » et le coller
dans HomeHub (même onglet Extension, « Marquer les lignes »). Le créneau et le paiement se font sur le site.

**À confirmer lors du premier essai réel** : la structure de la fiche une fois connecté (bouton « Ajouter »,
sélecteur de quantité, compteur du panier, prix) n'a jamais été vue ; les sélecteurs sont réunis dans
`extension/src/coursesu.ts` (`SELECTORS`) et la procédure d'essai est dans
[l'étude, section 7](docs/etude-drive.md#7-essai-réel-de-lextension-à-faire-par-lutilisateur).

## Configuration

Un fichier YAML validé, **rechargé à chaud** : le serveur le surveille et l'applique en quelques secondes, puis la
tablette se recharge (au plus 30 s). Au démarrage, un fichier invalide empêche l'app de démarrer ; ensuite, la
configuration précédente est conservée et l'erreur est journalisée.
Modèle commenté : [`config/homehub.example.yaml`](config/homehub.example.yaml).

```yaml
members:
  - id: lea          # minuscules, chiffres, tirets ; utilisé dans l'URL /p/lea
    name: Léa
    color: "#3fb8a8"
    calendars: [CAL_LEA]   # variable d'environnement : CAL_LEA=https://calendar.google.com/…/basic.ics
family:
  name: Famille
  calendars: [CAL_FAMILLE]
ui:
  idleTimeoutSeconds: 180
kiosk:
  addresses: [192.168.1.50]   # facultatif : adresse fixe de la tablette (sinon, sa clé HOMEHUB_KIOSK_KEY)
trustedProxies: [172.20.0.0/16]  # facultatif : proxy qui peut donner l'adresse du client (X-Real-IP) ; défaut : aucun
holidays:            # facultatif : vacances scolaires (la page « Vacances scolaires » prend le pas) ; sinon, aucune
  academie: Nantes   # ou zone: B (A, B ou C) ; Corse et outre-mer : academie: Corse, Réunion…
recipes:             # facultatif
  allowedHosts: []   # sites autorisés malgré une adresse privée (un serveur de recettes de la maison) ; défaut : aucun
weather:             # facultatif : sans cette section, pas de météo
  label: Paris
  latitude: 48.85    # deux décimales (~1 km) suffisent
  longitude: 2.35
```

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `HOMEHUB_CONFIG` | `config/homehub.yaml` (image Docker : `/data/homehub.yaml`) | Fichier de configuration |
| `HOMEHUB_STATIC_ROOT` | `./web/dist` | Front compilé |
| `CAL_…` (noms libres) | — | Adresses secrètes iCal référencées par `calendars` |
| `ECOLEDIRECTE_IDENTIFIANT`, `_MOTDEPASSE`, `_CN`, `_CV` | — | Compte Famille ÉcoleDirecte et jetons de confiance (script d'appairage) |
| `HOMEHUB_STATE_DIR` | `state` (image Docker : `/state`) | Dossier inscriptible : jeton Pronote (`pronote.json`), listes (`lists.json`), mots (`notes.json`), téléphones reliés (`devices.json`), PIN des profils (`pins.json`), visages (`faces.json`), routines cochées (`routines.json`) et leurs réglages (`routine-plans.json`), minuteurs (`timers.json`), stock, produits et contenants (`stock.json`), programmes de sport (`fitness.json`), carnet de recettes (`recipes.json`) et leurs photos (`recipes/`), notes de la famille sur les recettes (`recipe-notes.json`), menus de la semaine, « j'en ai déjà », décisions « à vérifier au placard », placards et produits reliés aux ingrédients (`menus.json`), drive : enseigne, magasin, produits retenus (avec les pièces par paquet et le dernier prix vu par l’extension) et panier en cours (`drive.json`)
, réglage des vacances scolaires (`holiday-settings.json`) et dernier calendrier reçu (`school-holidays.json`) |
| `HOMEHUB_KIOSK_KEY` | — | Clé secrète de la tablette (20 caractères au moins, ex. `openssl rand -base64 24`), donnée une fois dans son adresse de démarrage : `https://…/#key=<clé>` |
| `HOMEHUB_NAS_STATUS` | `nas-status.json` à côté de la configuration | Relevé du NAS lu par la page NAS (écrit par `scripts/nas-status.sh` de nas-config) |

## Architecture

```
shared/types.ts            contrat de l'API (types partagés serveur / front)
server/
  index.ts                 racine de composition : env, config, sources, service, serveur
  config.ts                schéma zod + chargement du YAML
  config-store.ts          configuration courante, révision, rechargement à chaud du fichier
  app.ts                   routes HTTP (fines : validation → service → JSON)
  services/dashboard.ts    logique métier, sans HTTP ni implémentation de source
  sources/types.ts         interfaces des sources (agenda, tâches, mots, météo) + horloge
  sources/sample.ts        agenda d'exemple, en mémoire (tant qu'aucun agenda n'est configuré)
  sources/open-meteo.ts    météo Open-Meteo
  sources/ical.ts          agendas iCal (adresses secrètes Google Agenda)
  sources/ecoledirecte.ts  emploi du temps, devoirs et vie scolaire ÉcoleDirecte (client de l'API privée + source)
  sources/pronote.ts       emploi du temps, devoirs et vie scolaire Pronote (Pawnote, jeton enregistré à chaque connexion)
  sources/homework.ts      devoirs : consigne HTML → texte, tri, fenêtre
  sources/irigo.ts         bus et tram Irigo : passages (SIRI), perturbations, cache
  sources/gtfs-rt.ts       lecture minimale d'un flux d'alertes GTFS-RT (protobuf)
  sources/gtfs.ts          horaires théoriques Irigo (GTFS) : arrêts proches, lignes directes, courses du jour
  sources/geocode.ts       recherche d'adresse (Géoplateforme de l'IGN)
  sources/transit-settings.ts  réglages de la page « Transports » (lieux, trajets, arrêts de l'accueil)
  sources/school-holidays.ts   vacances scolaires (calendrier officiel, cache d'un jour, aperçu)
  sources/holiday-settings.ts  réglage de la page « Vacances scolaires » (académie, zone ou aucune)
  sources/refreshing-cache.ts  cache des données distantes (rafraîchissement, repli en cas de panne)
  sources/source-status.ts dernier résultat de chaque source (page NAS)
  sources/nas-status.ts    relevé du NAS (nas-status.json, écrit par une tâche cron du NAS)
  services/nas.ts          page NAS : relevé, état des sources, version
  sources/lists.ts         courses et tâches (lists.json), tâches qui reviennent, articles fréquents
  sources/routines.ts      routines du matin et du soir cochées (routines.json), jours de suite
  sources/routine-plans.ts réglages des routines modifiés sur la tablette (routine-plans.json)
  sources/timers.ts        minuteurs (timers.json)
  sources/notes.ts         mots de la famille (notes.json), effacés une fois vus ou au bout de 7 jours
  sources/devices.ts       téléphones reliés (devices.json, empreinte du jeton seulement), codes d'appairage
  sources/stock.ts         stock (stock.json) : produits et leurs versions, mouvements annulables, contenants
  sources/fitness.ts       programmes de sport (fitness.json), réservés au téléphone de la personne
  sources/recipes.ts       carnet de recettes (recipes.json, photos dans recipes/), doublons par adresse
  sources/recipe-notes.ts  notes de la famille sur les recettes (recipe-notes.json), résolues ou ouvertes
  sources/web-page.ts      lecture d'une page web sûre : adresses publiques seulement, redirections revérifiées, taille et délai bornés
  sources/recipe-page.ts   recette d'une page (schema.org Recipe en JSON-LD ou microdonnées), site d'origine
  sources/mhtml.ts         page enregistrée (.mhtml) : parties MIME, quoted-printable, base64, document principal
  services/recipes.ts      import d'une recette (page, photo) et nettoyage d'une version modifiée
  services/recipe-imports.ts  texte collé et page enregistrée : aperçus en attente, boîte des fichiers partagés
  recipes-api.ts           routes du carnet de recettes
  recipe-notes-api.ts      routes des notes sur une recette (auteur ou parent pour modifier)
  sources/menus.ts         menus de la semaine (menus.json) : recettes et personnes, « j'en ai déjà », placards, produits reliés
  services/menu.ts         courses du menu : besoins, déductions (placards, stock…), synchronisation avec la liste de courses
  menu-api.ts              routes du menu de la semaine
  sources/drive.ts         drive (drive.json) : enseigne, magasin, produit retenu et secours par article, panier en cours
  sources/drive-page.ts    fiche produit d'une enseigne lue une fois à la demande (JSON-LD Product), sans contourner un refus
  drive-api.ts             routes du drive
  sources/open-food-facts.ts  bases de produits (Open Food Facts, Open Beauty Facts, Open Products Facts)
  access.ts                qui écrit : la tablette (clé, kiosk.addresses), un téléphone relié (jeton), sinon personne ; proxys de confiance
  lists-api.ts             routes des listes, de l'appairage et des téléphones
  stock-api.ts             routes du stock et du scanner
shared/school-holidays.ts  vacances scolaires et jours sans école : ce qu'on en dit chaque jour (puce)
shared/public-holidays.ts  jours fériés de métropole (Pâques calculé, fêtes mobiles)
shared/ingredients.ts      lignes d'ingrédients : quantité, unité, nom, clé, rayon ; mise à l'échelle et réécriture
shared/recipes.ts          recettes : types, limites, durées des étapes, portions, temps
shared/quantities.ts       quantités par dimension (masse, volume, cuillères, pièces) : somme, différence, affichage, contenance d'un paquet
shared/menu.ts             menu de la semaine : semaines, besoins agrégés, déductions, règle de synchronisation des courses
shared/stock-link.ts       produit du stock → ingrédient deviné (mots du nom, rayon, contenance)
shared/drive.ts            drive : enseignes, liens des fiches produit, JSON-LD Product, clé d'un article, paquets (pièces par paquet), remplir le panier, récapitulatif, prix vus
shared/drive-cart.ts       drive : panier copié pour l'extension et son compte rendu (format, relecture, prix affichés)
shared/recipe-notes.ts     notes sur une recette : limites, ordre (ouvertes, puis résolues), qui les modifie
shared/recipe-text.ts      recette dans un texte copié d'une page : sections, titre, portions, temps, bruit ignoré
shared/barcode.ts          codes-barres : clé de contrôle, forme sur 13 chiffres, étiquettes des contenants
web/src/
  main.ts                  racine de composition du front : API, routeur, horloge → contexte Svelte
  App.svelte               choix de l'écran, retour à l'accueil, surveillance de version
  screens/                 écrans (chargent leurs données via l'API du contexte)
  components/              composants d'affichage ; widgets/ = purement présentationnels
  lib/                     API, routeur, formats, couleurs, minuteries (logique testable sans DOM)
extension/                 extension « Remplir le panier » (Manifest V3, construite dans extension/dist)
  manifest.json            droits : stockage, site coursesu.com seulement
  popup.html               panneau du bouton de l'extension
  src/run.ts               déroulé d'un remplissage : décisions, règle d'arrêt, compte rendu (logique pure)
  src/coursesu.ts          adaptateur Courses U : lecture de la fiche, clics « Ajouter » et « + » (sélecteurs à confirmer)
  src/content.ts           script des pages du site : bandeau, boucle d'une fiche à l'autre
  src/popup.ts             panneau : coller le panier, lancer, arrêter, copier le compte rendu
scripts/build-extension.ts construit l'extension (Vite, un fichier par script)
scripts/extension-check.ts essai de l'extension dans Chrome sans fenêtre, sur la fausse enseigne du monde fictif
```

- **Injection de dépendances** : le service reçoit la config, les sources et l'horloge ; l'app HTTP reçoit le
  service. Côté front, `main.ts` fournit l'API, la config, le routeur et l'horloge par le contexte Svelte.
- **Ajouter une vraie source** (ex. Google Agenda) : implémenter `AgendaSource` dans `server/sources/`,
  puis la brancher dans `server/index.ts`. Ni le service, ni les routes, ni le front ne changent.

### API

| Route | Réponse |
|---|---|
| `GET /api/health` | `{ status, version, configRevision, time }` (healthcheck Docker ; le front se recharge si la version ou la révision change) |
| `GET /api/config` | membres, nom de la famille, réglages d'interface, révision |
| `GET /api/home` | météo, résumé de chaque profil, prochain événement familial, vacances scolaires à annoncer (`holiday`) |
| `GET /api/dashboard/:id` | dashboard d'un membre ou de `famille` (404 si inconnu) |
| `GET /api/nas` | relevé du NAS (`null` s'il est absent), état des sources, version et démarrage de HomeHub |
| `PUT /api/dashboard/:id/tasks/:taskId` | `{ "done": true }` → la tâche mise à jour (écriture) |
| `GET /api/dashboard/:id/routine` | `{ routine }` : la routine du moment seule (appli du téléphone), `null` hors de ses heures |
| `GET /api/transit` | `{ stops, alerts }` : prochains passages Irigo aux arrêts suivis, perturbations de leurs lignes |
| `GET /api/school/holidays` | `{ holiday, zone, holidays }` : ce qu'on dit des vacances scolaires et des jours fériés aujourd'hui (`soon`, `last-day`, `during`, `public-holiday`, `public-holiday-next`), la zone, les périodes à venir (`start` premier jour sans école, `end` reprise) ; zone et périodes `null` si non configurées (les jours fériés restent annoncés). `?academie=Nantes` ou `?zone=B` : aperçu d'un autre réglage (tablette ou téléphone appairé) |
| `GET /api/school/holidays/settings`, `PUT /api/school/holidays/settings` | réglage de la page « Vacances scolaires » `{ choice, saved, academies }` (tablette ou téléphone appairé) ; enregistrer : `{ choice }` avec `{ academie }`, `{ zone }` ou `null` (désactivées), un parent |
| `GET /api/school/life` | `{ children, messages }` : vie scolaire des enfants (notes récentes, absences et retards par enfant ; messages reçus par service, objet seulement). Un parent seulement : reconnu devant la tablette, ou son téléphone |
| `GET /api/dashboard/:id/homework` | `{ homework }` : les devoirs à faire seuls (appli du téléphone), `null` sans cahier de texte |
| `PUT /api/dashboard/:id/routine/:itemId` | `{ "done": true }` → l'étape de la routine du jour (`morning-0`, `evening-2`…) (écriture) |
| `GET /api/transit/settings`, `PUT /api/transit/settings` | réglages de la page « Transports » `{ places, commutes, stops }` (tablette ou téléphone appairé ; enregistrer : un parent) |
| `GET /api/transit/addresses?q=` | `{ addresses }` : adresses correspondantes (tablette ou téléphone appairé) |
| `GET /api/transit/stops?q=` ou `?near=lat,lon` | `{ stops }` : arrêts par nom ou proches d'un point, avec lignes et destinations |
| `GET /api/transit/routes?from=lat,lon&to=lat,lon` | `{ routes }` : lignes directes entre deux points, de la plus rapide à la plus lente |
| `GET /api/routines`, `PUT /api/routines` | réglages des routines `{ windows, members }` ; enregistrer : `{ windows, members }`, un parent |
| `GET /api/timers`, `POST /api/timers`, `DELETE /api/timers/:id` | minuteurs : liste ; lancer (`{ label, seconds }`, quelqu'un de reconnu) ; arrêter (en cours : quelqu'un de reconnu ; qui sonne : la tablette) |
| `GET /api/me` | `{ kiosk, device }` : l'appareil qui appelle (401 pour un téléphone retiré) |
| `GET /api/lists` | `{ shopping, tasks, frequent }` |
| `GET /api/notes`, `POST /api/notes` | mots des 7 derniers jours ; ajout : `{ to, text, from? }` (sur la tablette, `from` : profil ouvert ; `to` ≠ `from`) |
| `PUT /api/notes/:id/seen` | marque un mot vu (droit d'écriture sur son destinataire ; un mot à la famille : un parent) |
| `POST /api/lists/shopping`, `PUT`/`DELETE …/shopping/:id`, `POST …/shopping/clear` | courses (écriture) |
| `POST /api/lists/tasks`, `PUT`/`DELETE …/tasks/:id` | tâches (écriture) |
| `GET /api/pairing/pins` | `{ protected, parent }` : profils qui ont un PIN, code parent défini (tablette seulement) |
| `POST /api/pairing` | `{ ownerId, pin? }` → code d'appairage (tablette, personne reconnue qui peut écrire sur ce profil ; 403 si le PIN manque ou est faux, 429 si bloqué) |
| `POST /api/pairing/claim` | `{ code, name, system? }` → `{ token, device }` (410 si le code a expiré ou a servi) |
| `GET /api/devices`, `DELETE /api/devices/:id` | téléphones reliés (tablette seulement) ; retrait : personne reconnue qui peut écrire sur ce profil, et `{ pin }`, PIN du propriétaire ou code parent s'il en existe un |
| `PATCH /api/devices/:id` | `{ name }` : renomme un téléphone (tablette, personne reconnue qui peut écrire sur ce profil) |
| `GET /api/faces` | `{ enrolled, samples }` : profils dont le visage est enregistré, nombre d'empreintes enregistrées et apprises, et `uniform` si les enregistrées sont anormalement semblables (tablette seulement) |
| `POST /api/faces/identify` | `{ embedding, real, live }` → `{ ownerId, token }` (même session prolongée pour la même personne ; 401 : non reconnu ; tablette seulement) |
| `POST /api/faces/diagnose` | `{ embedding, real, live }` → `{ verdict, scores, rules }` : verdict détaillé, sans session ni apprentissage (tablette seulement) |
| `DELETE /api/faces/session` | termine la session de l'en-tête `X-Actor-Session` |
| `POST /api/faces/:id`, `DELETE /api/faces/:id` | enregistre (`{ embeddings, pin }`) ou efface (`{ pin }`) un visage : code parent obligatoire ; prises anormalement uniformes refusées (422) |
| `GET /api/stock` | `{ items, containers, settings }` : produits avec leur quantité, contenants, réglage par défaut |
| `GET /api/stock/scan/:code` | ce qu'est un code (13 chiffres) : `product` (avec quantité ; base lue si besoin), `container` ou `unknown` (tablette ou téléphone relié) |
| `PUT /api/stock/products/:code` | `{ name, brand, quantity, category }` : produit inconnu décrit, ou corrigé (notre version l'emporte) |
| `GET /api/stock/products/:code/movements` | historique d'un produit, du plus récent : `{ at, by, kind, count, price, forgotten, undone }` |
| `POST /api/stock/products/:code/recheck`, `…/accept-base`, `…/conflict` | relit la base (différences) ; prend sa version ; tranche un désaccord (`{ take: "mine" \| "base" }`) |
| `PATCH /api/stock/products/:code` | `{ autoShop, refill }` : liste de courses d'office (`null` : réglage par défaut), contenant habituel |
| `POST /api/stock/in`, `/out` | entrée (`{ code, count?, price? }`) ; sortie (`{ code, all?, refill?, remaining? }`, avec la proposition de liste de courses) ; la réponse donne `at` et `by` (qui a scanné) |
| `POST /api/stock/undo` | `{ movementId }` : annule le dernier mouvement d'un produit ou d'un contenant (409 sinon) |
| `POST /api/stock/shopping` | `{ code, always? }` : sur la liste de courses ; `always` : d'office la prochaine fois |
| `POST /api/stock/containers`, `PATCH`/`DELETE …/:id`, `POST …/:id/empty` | contenants : ajout, renommage, retrait, déclaré vide |
| `PUT /api/stock/settings` | `{ autoShop }` : réglage par défaut des produits épuisés |
| `GET /api/recipes` | `{ recipes }` : le carnet, du plus récent (titre, photo, portions, temps, Cookeo, site, auteur, `openNotes` : notes ouvertes) |
| `GET /api/recipes/:id`, `GET /api/recipes/:id/photo` | une recette (`ours` : notre version ; `source` : adresse, site, date, version lue) ; sa photo |
| `POST /api/recipes/import` | `{ url }` (ou un texte partagé qui contient le lien) → `{ recipe, existing }` (201 si nouvelle ; `existing` : déjà au carnet) ou `{ draft, reason }` quand la page n'a pas de recette lisible ; 400 pour une adresse refusée. Quelqu'un de reconnu ou un téléphone relié, vérifié avant toute lecture |
| `POST /api/recipes/import-text` | `{ text, url?, title? }` : texte copié d'une page → `{ preview: { token, content, url, site, origin, photo } }`, ou `{ recipe, existing: true }` si la page est déjà au carnet ; 422 sans ingrédient ni étape. Mêmes droits que l'import ; rien n'est lu sur le réseau. (Après un refus du site, `POST /api/recipes/import` répond `{ draft, reason, refused: true }`.) |
| `POST /api/recipes/import-page` | page enregistrée : fichier `.mhtml` (multipart, champ `page`) ou `{ shared }` (numéro reçu par `/partager`) → même réponse ; 400 si ce n'est pas une page enregistrée, 410 si le fichier partagé a expiré |
| `POST /partager` | cible de « Partager » (formulaire multipart) : lien ou texte renvoyés en `GET /partager?…` ; une page enregistrée mise en attente → `/partager?fichier=<numéro>` |
| `POST /api/recipes` | `{ content, url?, pending? }` : recette saisie à la main (avec le lien d'une page illisible), ou l'aperçu `pending` corrigé (sa source et sa photo sont reprises) |
| `POST /api/recipes/:id/reread` | relit la page d'origine → `{ recipe, updated, kept }` : les parties (titre, portions, ingrédients, étapes, temps, appareil) que notre version n'avait pas modifiées sont reprises, les autres gardées ; un parent ou qui l'a ajoutée ; 422 si la page n'a plus de recette lisible |
| `PUT /api/recipes/:id`, `DELETE /api/recipes/:id` | `{ content }` : notre version (un parent ou qui l'a ajoutée ; une ligne `manual` est gardée telle quelle) ; retrait : un parent (ses notes partent avec elle) |
| `GET /api/recipes/:id/notes`, `POST …/notes` | `{ notes }` : notes de la famille (lecture ouverte) ; `{ text }` (1 000 caractères au plus, 100 notes par recette, 409 au-delà) : tout membre identifié, enfants compris ; un appareil non appairé ne fait que lire |
| `PATCH /api/recipes/:id/notes/:note`, `DELETE …` | `{ text?, resolved? }` : texte modifié, note résolue ou rouverte ; retrait ; son auteur ou un parent |
| `GET /api/menu?week=<lundi>` | menu d'une semaine (par défaut la semaine en cours) : `{ week, current, editable, entries, plan, pantry, stock, ingredients }` ; `plan` : chaque ingrédient, ce qu'il faut, ce qui en est déduit et pourquoi (`buy`, `pantry`, `have`, `manual`, `bought`, `stock`), `check` (paquet peut-être entamé : `ask`, `enough`, `needed`) et `packs` (paquets à acheter) ; `stock` : produits avec `partial` (s'utilise en plusieurs fois) et `partialGuessed` |
| `POST /api/menu/entries`, `PUT`/`DELETE …/entries/:id` | `{ week, recipeId, people, day }` ; modification `{ people, day }` ; un parent ; semaines passées ou trop lointaines refusées ; la liste de courses suit |
| `PUT /api/menu/have` | `{ week, key, have }` : « j'en ai déjà » pour un ingrédient, cette semaine ; un parent |
| `PUT /api/menu/check` | `{ week, key, decision }` : « à vérifier au placard », `enough` (j'en ai assez), `needed` (il en faut) ou `null` (pas encore décidé) ; un parent |
| `PUT /api/menu/pantry` | `{ names }` : les placards, jamais demandés ; un parent |
| `GET /api/drive` | `{ settings, choices, basket }` : enseigne et magasin de retrait (`{ name, url }`), pour chaque article (`key`) le produit retenu (`preferred`, ou `null`) et ses secours (`fallback`), chacun `{ enseigne, id, url, name, brand, packText, pack, ean, source, pieces, price }` (`pieces` : pièces par paquet, ou `null` ; `price` : `{ value, at }`, dernier prix d'un paquet vu par l'extension, ou `null`), et le panier en cours (`{ enseigne, startedAt, startedBy, lines }`, ou `null`), chaque ligne `{ itemId, key, label, product, count, per, at, by }` ; seulement les lignes dont l'article est encore dans la liste |
| `PUT /api/drive/settings` | `{ enseigne, store }` : enseigne (`coursesu` ou `null`) et magasin (`{ name, url? }`, lien sur le site de l'enseigne) ; un parent |
| `GET /api/drive/stock?key=` | `{ hints }` : produits du stock qui ressemblent à l'article (reliés à l'ingrédient dans le menu, ou de même nom), avec code-barres et contenance |
| `POST /api/drive/read` | `{ url }` (ou un texte qui contient le lien d'une fiche produit) → `{ read: true, product, stock }` ou `{ read: false, product, reason, refused? }` (seulement ce que dit le lien) ; `stock` : produit du stock de même code-barres. Lu une fois, rien n'est retenu ; seulement une fiche de l'enseigne choisie ; droit sur la liste de courses, vérifié avant toute lecture |
| `PUT /api/drive/choices`, `DELETE /api/drive/choices?key=&id=` | `{ key, label, role, product: { url, name, brand?, packText?, ean?, source } }` : retenir un produit (`preferred`, l'ancien devient un secours) ou l'ajouter en secours (`fallback`) ; retrait d'un produit (`id`) ou de tout le choix ; le produit retenu retiré n'est remplacé par aucun secours ; droit sur la liste de courses |
| `PUT /api/drive/pieces` | `{ key, id, pieces }` : pièces dans un paquet du produit `id` de l'article (`null` : oublier) ; droit sur la liste de courses |
| `POST /api/drive/report` | compte rendu de l'extension « Remplir le panier » `{ kind: "homehub-drive-report", version: 1, enseigne, lines: [{ itemId, id, name, url, status, count, ean, price }] }` → `{ view, marked, prices, ignored }` : chaque article parti (`added`, `already`) et encore à acheter est mis au panier en cours avec ce produit et ces paquets ; prix et EAN lus notés sur le produit du choix (EAN seulement s'il manquait) ; lignes d'un article parti de la liste ou au lien hors des fiches de l'enseigne laissées de côté (`ignored`) ; droit sur la liste de courses |
| `PUT /api/drive/basket/:itemId`, `DELETE /api/drive/basket` | `{ in }` : cocher (`true`) ou décocher un article de la liste dans le panier en cours, le serveur y met le produit retenu et le nombre de paquets (sans produit : 1 paquet) ; article déjà acheté refusé (409) ; `DELETE` : nouveau panier. Renvoient la vue du drive ; droit sur la liste de courses |
| `PUT /api/menu/links/:code`, `DELETE …/links/:code` | `{ link }` : produit du stock relié à un ingrédient (`{ key, name, per, partial? }`, `partial` absent : deviné ; `null` : pas un ingrédient) ; retrait : redevient une proposition ; un parent |
| `GET /api/fitness` | programme de sport du profil du téléphone (rythme, réglages des exercices, séances, semaines, bilans) ; téléphone de la personne seulement |
| `POST /api/fitness/sessions`, `DELETE /api/fitness/sessions/:id` | séance terminée `{ session, rpe, stopped, note, exercises: [{ family, rating, pain, reps, note }] }`, ou retirée |
| `PUT /api/fitness/weeks/:lundi` | `{ cardio, waist }` de la semaine |
| `POST /api/fitness/rhythm` | `{ week, option }` : rythme choisi au bilan de la semaine (parmi ceux proposés) |
| `POST /api/fitness/slots` | `{ session, family, change }` : changement d'exercice accepté (`easier`, `harder`, `gentle`, `normal`) ou refusé (`dismiss`) |
| `PUT /api/fitness/settings` | `{ band, noJump }` : réglages du programme (élastique de tirage, sans sauts) |

Toutes les écritures du stock, et les lectures de la base de produits (`scan`, `recheck`) : tablette ou téléphone relié.

**Écriture** : la tablette est reconnue à sa clé (`HOMEHUB_KIOSK_KEY`, lue une fois dans `#key=…` puis envoyée dans
l'en-tête `X-Kiosk-Key` ; placée après `#`, elle n'apparaît jamais dans les journaux du proxy) ou à son adresse
(`kiosk.addresses`), un téléphone relié à son jeton
(`Authorization: Bearer`). Tout autre appareil lit sans écrire (403). La base de produits (`GET /api/stock/scan/:code`,
`POST …/recheck`), qui appelle Open Food Facts, est réservée comme les écritures du stock.

**Adresse du client** : `X-Real-IP` et `X-Forwarded-For` ne sont lus que si la connexion vient d'un proxy de
confiance (`trustedProxies`, adresses ou plages CIDR ; défaut : aucun). Sinon, c'est l'adresse de la connexion qui
compte : un appareil qui écrit `X-Real-IP: 127.0.0.1` reste un appareil du réseau. Dans `X-Forwarded-For`, l'adresse
retenue est la première en partant de la droite qui n'est pas un proxy de confiance. Une connexion locale directe
(`127.0.0.1` ou `::1`, sans en-tête de proxy : développement, vérification de santé du conteneur) compte comme la
tablette ; une adresse locale annoncée par un en-tête, jamais. Derrière Nginx Proxy Manager, la clé et les jetons
suffisent : `trustedProxies` ne sert que si `kiosk.addresses` doit reconnaître la tablette par son adresse. La tablette agit au nom de la personne reconnue
(en-tête `X-Actor-Session` ; sans elle : 403 avec `identify: true`), un téléphone au nom de son profil ; un parent
écrit partout, un enfant sur son profil seulement (`shared/rights.ts`). Les icônes de la PWA se régénèrent avec
`node scripts/make-icons.ts`.

## Développement

```bash
npm install
cp config/homehub.example.yaml config/homehub.yaml
cp server/sources/fixtures/nas-status.json config/nas-status.json   # facultatif : page NAS (relevé ancien)
npm run dev       # back sur :3000 + Vite sur :5173 (proxy /api → :3000)
npm test          # tests (vitest) : config, service, routes, utilitaires du front
npm run check     # vérification des types (server + web)
npm run build     # compile le front dans web/dist
npm start         # sert l'app compilée sur :3000
npm run docs:captures   # refait les captures de docs/images (données fictives, Chrome sans fenêtre)
npm run build:extension # construit l'extension « Remplir le panier » dans extension/dist
npm run extension:check # essaie l'extension sur la fausse enseigne (Chrome sans fenêtre, ~2 min) et refait ses captures
```

`DOCS_PORT=3290 npm run docs:captures` si le port 3190 est déjà pris (monde fictif d'une autre copie du dépôt).

Pour tester sur la tablette en dev : `http://<ip-du-pc>:5173`.

## Release et déploiement

1. Mettre à jour `version` dans `package.json`, commit.
2. `git tag vX.Y.Z && git push --follow-tags` → GitHub Actions vérifie (types, tests), construit et publie
   `ghcr.io/deaflight/homehub:X.Y.Z`.
3. Dans `nas-config`, passer le service `homehub` au tag `X.Y.Z`, commit + push.
4. Sur le NAS : `git pull --ff-only` puis `sudo scripts/update-apps.sh homehub`.

Sur le NAS, la configuration est `/mnt/X/docker/data/homehub/homehub.yaml`, montée en lecture seule sur `/data`.
