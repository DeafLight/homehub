# Écrans

Captures de HomeHub 0.30.1, avec des **données fictives** : famille de test (Alex, Sam, Léa, Tom), agenda d'exemple,
faux ÉcoleDirecte et faux temps réel Irigo, horloge arrêtée le jeudi 5 novembre 2026 à 07:35. La météo est réelle,
celle du jour de la capture.

Tablette : 1280 × 800 (Fully Kiosk). Téléphone : 390 × 844 (PWA).

Pour les refaire (après une modification du design, par exemple) : `npm run docs:captures`. Le script
[`scripts/docs-captures.ts`](../scripts/docs-captures.ts) compile le front, lance HomeHub dans le monde fictif de
[`scripts/docs-captures/`](../scripts/docs-captures/) (configuration, horloge, fausses sources), le remplit par l'API,
photographie chaque page avec Chrome sans fenêtre, puis la [planche du design](design.md) d'après `web/src/app.css`.
Chrome est cherché aux emplacements habituels ; sinon `CHROME=<chemin>`.

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

## Non capturés

- **Visages** : demande la caméra de la tablette.
- **Veille**, **minuteur qui sonne**, **sélecteur de durée**, **QR code d'appairage** : écrans passagers, à ajouter
  si besoin.
