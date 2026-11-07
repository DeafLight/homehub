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
  end
  tablette -- HTTPS --> npm
  tel -- HTTPS --> npm
  npm --> api
  npm --> front
  api --- yaml
  api --- etat
  cron --> releve --> api
  api --> meteo & ical & ecole & irigo & ign
```

## Couches du serveur

Les routes restent fines : elles valident, appellent le service, renvoient du JSON. Le service ne connaît ni HTTP ni
la façon dont une source obtient ses données. `server/index.ts` assemble le tout (injection de dépendances).

```mermaid
flowchart TB
  subgraph http["HTTP (server/app.ts, server/lists-api.ts)"]
    routes["Routes /api/*<br/>validation zod"]
    access["access.ts<br/>qui appelle : tablette, téléphone, personne"]
    rights["shared/rights.ts<br/>qui peut écrire sur quel profil"]
  end
  subgraph services["Services"]
    dash["services/dashboard.ts<br/>accueil, dashboards, semaine, trajets"]
    nasS["services/nas.ts<br/>page NAS"]
  end
  subgraph sources["Sources (server/sources/)"]
    distant["Distantes, en cache<br/>open-meteo, ical, ecoledirecte, pronote,<br/>irigo, gtfs, geocode"]
    locales["Locales, fichiers JSON<br/>lists, notes, routines, routine-plans,<br/>timers, devices, pins, faces,<br/>transit-settings"]
    cache["refreshing-cache.ts<br/>rafraîchit, garde la dernière valeur"]
    status["source-status.ts<br/>dernier succès ou erreur"]
  end
  config["config-store.ts<br/>YAML, rechargé à chaud"]
  horloge["Horloge injectée<br/>(tests à date fixe)"]

  routes --> access --> rights
  routes --> dash & nasS
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
  app --> ecrans["screens/<br/>Home, Dashboard, Week, Weather,<br/>Lists, Routines, Transit, Phones,<br/>Faces, Nas, Phone (PWA)"]
  ecrans --> comp["components/<br/>cartes, panneaux, minuteurs"]
  comp --> widgets["components/widgets/<br/>affichage pur"]
  ecrans --> lib["lib/<br/>logique sans DOM, testée<br/>(formats, semaine, trajets, routines…)"]
  app -. "toutes les 30 s" .-> health["/api/health<br/>version, révision de config"]
  health -. "changée" .-> reload["Rechargement de la page"]
```

## Modèle de données

Les principaux types de `shared/types.ts`, partagés par le serveur et le front, et le fichier d'état qui les garde.

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
```

| Fichier d'état | Contenu |
|---|---|
| `lists.json` | courses et tâches |
| `notes.json` | mots (effacés une fois vus, ou au bout de 7 jours) |
| `routines.json` | étapes cochées du jour, jours de suite |
| `routine-plans.json` | étapes et heures des routines |
| `timers.json` | minuteurs en cours |
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
  qui -- "clé X-Kiosk-Key<br/>ou adresse de la tablette" --> tab["Tablette"]
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
