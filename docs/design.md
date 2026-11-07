# Design

État actuel (0.30.1), relevé dans le code : c'est le point de départ de la refonte prévue dans le
[TODO](../TODO.md).

![Planche du design](images/planche-design.png)

## Principes

- **Thème sombre unique** (`color-scheme: dark`) : la tablette reste allumée dans la pièce de vie.
- **Lisible de loin, touché au doigt** : très grands chiffres (horloge, météo), cibles larges, pas de survol.
- **Une couleur par profil**, choisie dans `homehub.yaml` : avatar, pastilles, agenda dans la semaine, bordure des
  tuiles du dashboard focus.
- **Couleurs de sens réservées** : jaune pour le soleil et les avertissements, bleu pour la pluie et l'action
  principale, vert / orange / rouge / gris pour les états (page NAS, temps réel).
- **Cartes arrondies** sur fond presque noir ; pastilles entièrement arrondies pour les filtres et les boutons.
- **Police du système** (`system-ui`, Segoe UI, Roboto) : rien à télécharger.

## Variables CSS (`web/src/app.css`)

| Variable | Valeur | Usage |
|---|---|---|
| `--bg` | `#0f1115` | fond de page |
| `--surface-rail` | `#14171d` | rail des profils |
| `--surface` | `#181b22` | cartes |
| `--surface-2` | `#262a33` | boutons, éléments dans une carte |
| `--border-strong` | `#3a3f4a` | bordures appuyées |
| `--fg` | `#e8eaed` | texte |
| `--fg-soft` | `#cfd3d9` | texte secondaire |
| `--fg-muted` | `#9aa1ab` | légendes, heures |
| `--sun` | `#f2b84b` | soleil |
| `--rain` | `#5b8def` | pluie, bouton principal |
| `--rain-soft`, `--rain-bg` | `#9cc3f5`, `#1e2a3a` | pluie (courbe, fond) |
| `--danger-bg`, `--danger-fg` | `#4a1f1d`, `#ffb4ab` | erreurs, retard |
| `--ok`, `--ok-bg`, `--ok-fg` | `#3fcf7f`, `#173b2c`, `#bfeccf` | état normal |
| `--warn`, `--warn-bg` | `#f2b84b`, `#3d3018` | à surveiller |
| `--bad` | `#ff7a6b` | critique |
| `--off` | `#4a505c` | arrêté, inconnu |
| `--radius-md`, `--radius-lg`, `--radius-xl` | 24, 28, 32 px | arrondis des cartes |

## Écrans

Captures de chaque page : [ecrans.md](ecrans.md).

## Points relevés pour la refonte

- **Dashboard élève, colonne de droite (1280 × 800)** : la carte « Routine du matin » est coupée sous son titre et
  la carte « Mes tâches » chevauche le haut de la suivante ([capture](images/tablette-dashboard.png)).
- **Accueil** : le bloc des bus grandit avec chaque arrêt suivi et pousse le reste de la colonne
  ([capture](images/tablette-accueil.png)).
- **Noms des matières** : en capitales sans accents dans ÉcoleDirecte, remis en minuscules mais toujours sans accent
  (« Mathematiques », « Francais »).
- **Pages de réglages** (Routines, Transports) : le bouton « Enregistré » reste en bas à droite, loin des
  modifications.
- Variables CSS limitées aux couleurs et aux arrondis : tailles de texte et espacements sont écrits page par page.
