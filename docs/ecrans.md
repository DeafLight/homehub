# Écrans

Captures de HomeHub 0.46.0, avec des **données fictives** : famille de test (Alex, Sam, Léa, Tom), agenda d'exemple,
faux ÉcoleDirecte, faux temps réel Irigo, produits et marques inventés à la place d'Open Food Facts, calendrier
scolaire d'exemple (zone B), horloge arrêtée le jeudi 5 novembre 2026 à 07:35 (le 11 novembre et en décembre pour les fériés et les vacances). La météo est réelle,
celle du jour de la capture.

Tablette : 1280 × 800 (Fully Kiosk). Téléphone : 390 × 844 (PWA).

Pour les refaire (après une modification du design, par exemple) : `npm run docs:captures`. Le script
[`scripts/docs-captures.ts`](../scripts/docs-captures.ts) compile le front, lance HomeHub dans le monde fictif de
[`scripts/docs-captures/`](../scripts/docs-captures/) (configuration, horloge, fausses sources), le remplit par l'API,
photographie chaque page avec Chrome sans fenêtre, puis la [planche du design](design.md) d'après `web/src/app.css`.
Chrome est cherché aux emplacements habituels ; sinon `CHROME=<chemin>`. Pour essayer à la main ce monde fictif
(scanner compris, codes tapés à la main) : `DOCS_SERVE=1 node scripts/docs-captures.ts`, puis `http://localhost:3190`.

## Tablette

### Accueil

Horloge, météo, prochains passages aux arrêts suivis, prochain événement de la famille ; à droite, « Qui est là ? »
avec le prochain rendez-vous et les mots non lus de chacun. En bas, un minuteur en cours.

![Accueil](images/tablette-accueil.png)

### Dashboard d'un élève

Bandeau du trajet du matin, frise du jour avec la bascule « Aujourd'hui | Demain » (cours, agenda), la carte du
moment en grand (ici la routine du matin) et le reste en tuiles : devoirs, tâches, mots, prochain rendez-vous.

![Dashboard de Léa](images/tablette-dashboard.png)

### Vacances scolaires

Trois semaines avant les vacances, une puce dans l'en-tête des dashboards (et sous l'horloge de l'accueil) les
annonce ; ici le lundi 7 décembre :

![Vacances de Noël dans 12 jours](images/tablette-vacances-bientot.png)

Pendant les vacances (lundi 21 décembre), la puce passe au soleil et donne le jour de la reprise. Sur le dashboard de
Léa : plus de bandeau du bus ni de cours, et la routine du matin sans « Cartable » (étape des jours d'école).

![Accueil pendant les vacances](images/tablette-vacances.png)

![Dashboard de Léa pendant les vacances](images/tablette-vacances-dashboard.png)

Sur le téléphone, la même puce en tête de l'agenda :

<img src="images/telephone-agenda-vacances.png" alt="Agenda du téléphone pendant les vacances" width="260">

Un jour férié compte comme un jour de vacances pour l'école. Mercredi 11 novembre, la puce dit « Férié · 11 novembre »
(la veille : « Demain férié · 11 novembre ») ; ni bus ni cours ce jour-là, routine du matin sans « Cartable ».

![Dashboard de Léa un jour férié](images/tablette-ferie-dashboard.png)

### Dashboard de la famille

Prochaine activité commune, liste de courses, semaine, mots à toute la famille.

![Dashboard de la famille](images/tablette-dashboard-famille.png)

### Semaine

Les 7 jours, chaque agenda à la couleur de son profil ; filtres par personne et pour les cours.

![Semaine](images/tablette-semaine.png)

### Météo

Conditions actuelles, courbe des 24 heures, 4 jours.

![Météo](images/tablette-meteo.png)

### Listes

Courses et tâches de la famille ; tâches en retard en rouge, tâches qui reviennent.

![Listes](images/tablette-listes.png)

### Stock

Produits en stock (± 1, « Épuisé »), avec sous chacun la dernière entrée et la dernière sortie (quand, et qui :
Alex et Léa par leur téléphone, « anonyme » pour un scan sur la tablette sans personne de reconnu ; un produit épuisé ne dit que quand et par qui il l'a été), contenants de la maison (bocal rechargé, étiquette à imprimer), réglage de la
liste de courses pour un produit épuisé.

![Stock](images/tablette-stock.png)

### Scanner

Mode « Jeté / épuisé » : le paquet de café scanné est d'habitude transvasé dans le bocal, d'où la question ; le
bandeau orange reste tant que le produit est devant la caméra. À droite, au nom de qui sont les scans (ici personne de reconnu : anonymes), puis les passages avec leur heure et
leur auteur, chacun annulable. (Sans caméra
dans Chrome sans fenêtre : codes saisis à la main.)

![Scanner](images/tablette-scanner.png)

### Sport

Depuis le bouton « Sport » du dashboard d'Alex (affiché seulement quand Alex est reconnu devant la tablette) : sa séance du jour (sans rien de
personnel) et le catalogue des exercices. Puis la séance guidée, échauffement passé : premier effort, compte à
rebours, animation. Pour un exercice d'un côté puis de l'autre (montées genou levé), juste après la moitié de
l'effort : bip distinct et « Change de côté ! ». (Sans caméra dans Chrome sans fenêtre : la session d'un visage fictif
est présentée avec chaque requête.)

![Sport](images/tablette-sport.png)

![Séance guidée](images/tablette-seance.png)

![Change de côté](images/tablette-seance-cote.png)

### Routines (réglages)

Étapes du matin et du soir de chaque membre, jours de chaque étape, heures d'affichage.

![Routines](images/tablette-routines.png)

### Transports (réglages)

Lieux de la famille, trajet de chacun, arrêts de l'accueil. Ici, avant le premier enregistrement.

![Transports](images/tablette-transports.png)

### Vacances scolaires (réglages)

Calendrier de l'académie (liste regroupée par zone, filtrée par la saisie), d'une zone entière, ou aucun ; à droite,
l'aperçu des prochaines vacances avant d'enregistrer. Ici, l'académie de Nantes, venue du fichier de configuration ;
sans section `holidays` ni rien d'enregistré, la page s'ouvre sur « Aucune ».

![Vacances scolaires](images/tablette-vacances-reglages.png)

### Téléphones

Relier un téléphone à un profil (QR code), voir et retirer les téléphones reliés.

![Téléphones](images/tablette-telephones.png)

### Le NAS

État général, jauges, points à surveiller, services, événements récents (relevé d'exemple).

![Le NAS](images/tablette-nas.png)

## Téléphone (PWA)

| Courses | Tâches et devoirs | Agenda | Mots |
|---|---|---|---|
| ![Courses](images/telephone-courses.png) | ![Tâches](images/telephone-taches.png) | ![Agenda](images/telephone-agenda.png) | ![Mots](images/telephone-mots.png) |

### Stock du téléphone

« Ce qu'il reste à la maison », en haut de l'onglet Courses : pour le voir au magasin. Recherche, produits en stock
ou épuisés, ± 1 et « Épuisé » ; ni date ni auteur dans la liste, ils restent dans la fiche du produit ; plus bas, les
contenants en lecture seule.

<img src="images/telephone-stock.png" alt="Stock du téléphone" width="260">

### Sport

Onglet Sport, pour un adulte qui a un programme (Alex) : la prochaine séance (palier, rythme, durée, les six
exercices, avec leur vignette), un changement d'exercice proposé, la semaine (cardio, tour de taille et sa courbe),
l'historique ; la fiche d'un exercice (animation, consignes, muscles sur la silhouette, erreurs fréquentes, autres
versions) ; la fin de séance (ressenti global,
puis difficulté, gêne, répétitions et note par exercice).

| Prochaine séance | Fiche d'un exercice | Fin de séance |
|---|---|---|
| ![Sport](images/telephone-sport.png) | ![Exercice](images/telephone-sport-exercice.png) | ![Fin de séance](images/telephone-sport-seance.png) |

Prochaine séance ci-dessus : palier 2 choisi lundi, en deux temps ; dans la séance 3, pas encore faite, jambes, dos et gainage sont « nouveau au
palier 2 » (avec l'exercice d'avant), cardio, poussée et une jambe passent « après la prochaine bonne semaine ».
Réglages du programme cochés (élastique de tirage, sans sauts) : la séance 1 avec le rowing à l'élastique et les
jumping jacks sans saut « à la place de » Jumping jacks ; la carte des réglages, en bas de l'onglet.

| Avec les réglages | Réglages du programme |
|---|---|
| ![Réglages appliqués](images/telephone-sport-reglages.png) | ![Réglages](images/telephone-sport-reglages-carte.png) |

Statistiques (lien sous l'historique), sur six semaines de séances fictives : le résumé et les séances par semaine
(toucher une barre ou un point affiche sa valeur dessous), le temps d'effort et le ressenti moyen, chaque exercice
avec la courbe de ses répétitions.

| Résumé | Progression | Par exercice |
|---|---|---|
| ![Statistiques](images/telephone-sport-stats.png) | ![Progression](images/telephone-sport-stats-progression.png) | ![Par exercice](images/telephone-sport-stats-exercices.png) |

### Scanner du téléphone

Bouton code-barres de l'onglet Courses. Un paquet vient d'être lu et reste devant la caméra : le bandeau donne le
nom, la marque et la contenance, ce qui a été fait, et demande de retirer le produit (il n'est compté qu'une fois).
Les scans sont au nom du profil du téléphone (Alex), chaque passage avec son heure.
Capture faite avec la fausse caméra de Chrome et un faux lecteur de codes-barres.

<img src="images/telephone-scanner.png" alt="Scanner du téléphone" width="260">

## Non capturés

- **Visages** : demande la caméra de la tablette.
- **Veille**, **minuteur qui sonne**, **sélecteur de durée**, **QR code d'appairage** : écrans passagers, à ajouter
  si besoin.
