# Écrans

Captures de HomeHub 0.34.0, avec des **données fictives** : famille de test (Alex, Sam, Léa, Tom), agenda d'exemple,
faux ÉcoleDirecte, faux temps réel Irigo, produits et marques inventés à la place d'Open Food Facts, horloge arrêtée le jeudi 5 novembre 2026 à 07:35. La météo est réelle,
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

Bandeau du trajet du matin, frises du jour et du lendemain (cours, agenda), routine du moment, tâches et mots.

![Dashboard de Léa](images/tablette-dashboard.png)

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
Alex et Léa par leur téléphone, « anonyme » pour un scan sur la tablette sans personne de reconnu), contenants de la maison (bocal rechargé, étiquette à imprimer), réglage de la
liste de courses pour un produit épuisé.

![Stock](images/tablette-stock.png)

### Scanner

Mode « Jeté / épuisé » : le paquet de café scanné est d'habitude transvasé dans le bocal, d'où la question ; le
bandeau orange reste tant que le produit est devant la caméra. À droite, au nom de qui sont les scans (ici personne de reconnu : anonymes), puis les passages avec leur heure et
leur auteur, chacun annulable. (Sans caméra
dans Chrome sans fenêtre : codes saisis à la main.)

![Scanner](images/tablette-scanner.png)

### Routines (réglages)

Étapes du matin et du soir de chaque membre, jours de chaque étape, heures d'affichage.

![Routines](images/tablette-routines.png)

### Transports (réglages)

Lieux de la famille, trajet de chacun, arrêts de l'accueil. Ici, avant le premier enregistrement.

![Transports](images/tablette-transports.png)

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
