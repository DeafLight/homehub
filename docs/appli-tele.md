<!-- Plan de l'appli Android TV « HomeHub TV », compagnon de HomeHub : architecture, outils, mise en place sur la télé,
     mise à jour, ordre des fonctions. À valider avant tout code. -->

# HomeHub TV — appli Android TV (plan, à valider)

Une petite appli installée sur la télé du salon (Android TV 10, installée hors du Play Store par `adb`). Elle reste
connectée à HomeHub et affiche ou fait entendre ce qu'il lui envoie **par-dessus ce qui passe, sans le couper**.

Pourquoi une appli maison : le message vocal de la 0.68 passe par le récepteur Cast, qui prend le premier plan, coupe la
vidéo puis se ferme ; l'appli « Notifications for Android TV » de la 0.67 n'affiche que du texte et demande un port
ouvert sur la télé. PiPup est écartée (abandonnée depuis 2019, pas d'APK officiel, pas d'atténuation du son, rien à
l'écran pour un son seul). Une appli à nous ne vaut son coût que si elle fait tout cela et plus : d'où la liste de
fonctions plus bas.

## 1. Architecture

```
 Téléphone d'un parent ──POST──▶  HomeHub (NAS)  ◀──attente longue── HomeHub TV (télé)
 Tablette               ──POST──▶  file par télé  ──événement──────▶  bandeau, son atténué…
                                   présence       ◀──compte rendu─── « lu », « refusé : télé éteinte »
```

- **La télé appelle HomeHub, jamais l'inverse.** Comme la page tablette de la caméra en direct (`server/camera-api.ts`,
  `server/services/live-camera.ts`), l'appli demande ses événements par **interrogation longue** :
  `GET /api/screen/events?after=n` répond dès qu'un événement arrive, ou vide au bout de 25 s (sous le délai des
  proxys), et l'appli redemande aussitôt. Aucun port ouvert sur la télé, rien de plus à configurer dans le proxy, et ça
  marche aussi bien en direct (`http://<NAS>:<port>`) que derrière Nginx Proxy Manager.
- **Présence** : une télé qui n'a pas redemandé depuis 40 s (`GONE_MS`) est « absente » (éteinte, appli tuée, réseau
  perdu). C'est la base de la fonction 7 (basculer vers le Google Home).
- **Compte rendu** : après chaque événement, l'appli répond `POST /api/screen/events/:seq/done` avec `played`,
  `shown` ou `failed` + raison. Le téléphone qui a envoyé attend ce compte rendu (quelques secondes au plus) pour
  afficher « Lu sur la télé » ou l'erreur, comme aujourd'hui pour Cast.
- **Les médias** : un message vocal reste en mémoire sur le serveur (`server/services/voice-messages.ts`, 5 min,
  adresse impossible à deviner). L'appli le télécharge avec son jeton (en-tête `Authorization`), pas besoin du port des
  médias ni de `cast.mediaUrl`.

### Appairage et droits

Une télé n'est pas un téléphone : elle n'appartient à personne et **n'écrit rien**. Si on la rangeait dans les
téléphones (`server/sources/devices.ts`, qui lie chaque jeton à un profil), son jeton donnerait le droit d'écrire sur
un profil. Proposition :

- **Magasin à part** `server/sources/screens.ts` (`screens.json` dans `HOMEHUB_STATE_DIR`), même principe que
  `devices.ts` : seule l'empreinte du jeton est gardée. Un jeton de télé n'est jamais reconnu comme téléphone, et
  inversement.
- **Nouveau droit** dans `server/access.ts` : `access.screen(c)` → la télé qui présente ce jeton, sinon 401/403.
  Les routes `/api/screen/*` (événements, comptes rendus, téléchargement d'un message) n'acceptent que lui ; toutes les
  autres routes refusent ce jeton (lecture seule comme un appareil non appairé, et rien de personnel).
- **Appairage par code affiché sur la télé** (pas de saisie à la télécommande) :
  1. au premier lancement, l'appli demande un code : `POST /api/screen/pairing` → code court (6 lettres, 5 min) et un
     identifiant de demande ; elle affiche le code en grand ;
  2. un parent ouvre sur la tablette la page des appareils reliés, section « Télé », et tape le code (parent reconnu
     ou code parent, comme pour retirer un téléphone) ;
  3. l'appli, qui attendait (`GET /api/screen/pairing/:id`, interrogation longue), reçoit son jeton une seule fois.
  La télé apparaît ensuite dans la liste (nom, dernière connexion, « Retirer »). Retirée : 401, l'appli revient à
  l'écran d'appairage.
- **Adresse de HomeHub** : donnée une fois à l'installation, par `adb` (pas de saisie à la télécommande) :
  `adb shell am start -n fr.homehub.tv/.SetupActivity --es server https://homehub.exemple`. Rien de réel dans le dépôt.
- **Qui peut envoyer** : les routes d'envoi gardent leurs règles. Message vocal : téléphone d'un parent, `camera.talk`.
  Message écrit : un parent (téléphone ou reconnu à la tablette). Le serveur vérifie toujours, le front ne fait
  qu'anticiper (règle 4 du dépôt).
- **Rien de personnel à l'écran** : la télé est vue de tous, comme la tablette. Pas de sport, pas de visage, pas de note.
- **Version du protocole** : l'appli envoie `X-HomeHub-Screen: 1`. Un serveur qui ne la connaît pas répond 426 avec un
  message que l'appli affiche (« Mettre à jour HomeHub TV »).

### Côté serveur (fichiers prévus)

| Fichier | Rôle |
|---|---|
| `server/sources/screens.ts` | Télés appairées (jetons hachés), codes d'appairage |
| `server/services/screens.ts` | File d'événements par télé, attente longue, présence, comptes rendus |
| `server/screen-api.ts` | Routes de la télé (`/api/screen/*`) et de l'appairage |
| `shared/screen.ts` | Types des événements (`voice`, `message`, puis `timer`, `bus`…), communs au front |
| `server/cast-api.ts`, `server/tv-api.ts` | Destination « Télé (appli) » en plus de Cast et de l'appli tierce |
| `web/src/…` | Onglet Caméra du téléphone : « Ta voix sur » Tablette / **Télé** / appareils Cast ; page des appareils de la tablette : section Télé |

## 2. Où vit le code

**Proposition : un sous-dossier `tv-app/` de ce dépôt** (Kotlin, Gradle), plutôt qu'un dépôt séparé :

- le protocole évolue avec le serveur : une seule branche, une seule version, une seule revue ;
- un seul numéro de version (`versionName` de l'appli = version de HomeHub), une seule note de version ;
- la doc (`README.md`, `docs/ecrans.md`, ce plan) reste au même endroit ;
- plus tard, la CI GitHub peut construire l'APK (les machines Ubuntu de GitHub ont déjà le SDK Android) et le joindre
  à la version taguée.

Inconvénients acceptés : le dépôt a deux chaînes d'outils (npm et Gradle), et `npm run check` / `npx vitest run` ne
couvrent pas le Kotlin (l'appli a ses propres tests JVM : `gradlew test`). Le dossier est ignoré par TypeScript et Vite.

Choix techniques de l'appli, pour rester petite :

- **Kotlin, vues Android classiques, sans Compose ni AndroidX lourds** : APK de quelques centaines de Ko.
- **Aucune bibliothèque réseau** : `HttpURLConnection` et `org.json` du système suffisent pour une interrogation longue
  et un téléchargement.
- `minSdk 29` (Android 10, la télé), `targetSdk` récent ; un service au premier plan pour rester vivant, démarré au
  démarrage de la télé (`BOOT_COMPLETED`).
- Thème sombre, couleurs reprises des variables de `web/src/app.css` (`--bg`, `--surface`, `--fg`, `--rain`, `--sun`).

## 3. Outils à installer sur le PC (Windows)

Rien n'est installé aujourd'hui (Java 8 seulement, trop ancien pour les outils Android actuels). **Rien ne sera
téléchargé sans ton accord**, outil par outil, avec la source et la taille annoncées au moment de le faire. Tailles
approximatives, à confirmer au téléchargement :

| Outil | Source | Téléchargement | Sur le disque |
|---|---|---|---|
| JDK 17 (Eclipse Temurin, MSI ou zip) | adoptium.net | ≈ 190 Mo | ≈ 320 Mo |
| Outils en ligne de commande Android (`sdkmanager`) | dl.google.com (developer.android.com) | ≈ 150 Mo | ≈ 170 Mo |
| `platform-tools` (dont `adb`) | via `sdkmanager` | ≈ 8 Mo | ≈ 20 Mo |
| Plateforme Android 35 et `build-tools` 35 | via `sdkmanager` | ≈ 130 Mo | ≈ 250 Mo |
| Gradle (par le `gradlew` du projet) | services.gradle.org | ≈ 135 Mo | ≈ 150 Mo |
| Dépendances de compilation (plugin Android, Kotlin, R8) | Google Maven, Maven Central | ≈ 400 Mo | ≈ 700 Mo |
| **Total** | | **≈ 1 Go** | **≈ 1,6 Go** |

- Pas d'Android Studio (≈ 1,3 Go à télécharger, 3 à 5 Go installé) : inutile pour ce projet, les commandes suffisent.
- Le Java 8 existant reste en place ; le JDK 17 est désigné par `JAVA_HOME` pour Gradle seulement.
- `sdkmanager --licenses` demande d'accepter les licences du SDK Android : c'est à toi de les accepter.
- Emplacement proposé : `C:\Android\sdk` (SDK), JDK dans `C:\Program Files\Eclipse Adoptium\`.
- Option plus légère pour plus tard : la CI construit l'APK, et le PC n'a besoin que de `platform-tools` (`adb`) pour
  l'installer. Pour développer et essayer vite, le SDK local reste nécessaire au début.

## 4. Mise en place sur la télé (une fois)

1. **Options pour développeurs** : Paramètres → Préférences de l'appareil → À propos → appuyer 7 fois sur « Build ».
2. **Débogage** : Options pour développeurs → « Débogage USB » (sur Android 10, il ouvre aussi `adb` sur le réseau,
   port 5555, chez la plupart des fabricants ; si la télé propose « Débogage réseau » / « ADB over network », l'activer).
   Le jumelage par code (`adb pair`) n'existe qu'à partir d'Android 11.
3. **Réserver l'adresse IP de la télé** dans la box (elle l'est déjà pour Cast).
4. **Première connexion** depuis le PC : `adb connect <ip-de-la-télé>:5555` ; la télé demande « Autoriser le
   débogage ? » : cocher « Toujours autoriser depuis cet ordinateur » et accepter à la télécommande.
5. **Installer** : `adb install tv-app\app\build\outputs\apk\release\homehub-tv.apk`.
6. **Autorisations** (souvent absentes des menus d'Android TV, d'où `adb`) :
   - afficher par-dessus les autres applis (bandeaux) :
     `adb shell appops set fr.homehub.tv SYSTEM_ALERT_WINDOW allow` ;
   - (fonction 6, plus tard, seulement si l'envoi de touches média ne suffit pas) accès aux notifications pour lire la
     session média en cours : `adb shell cmd notification allow_listener fr.homehub.tv/.MediaListener` ;
   - (fonction 8) écran de veille HomeHub :
     `adb shell settings put secure screensaver_components fr.homehub.tv/.HomeHubDream`.
7. **Adresse de HomeHub** : `adb shell am start -n fr.homehub.tv/.SetupActivity --es server <adresse>` ; l'appli
   affiche alors le code d'appairage, à taper sur la tablette.
8. **Éviter qu'elle soit tuée** : vérifier qu'elle repart après un redémarrage et une mise en veille ; si le fabricant
   tue les applis en arrière-plan, l'exclure de l'optimisation de batterie
   (`adb shell dumpsys deviceidle whitelist +fr.homehub.tv`).

Les commandes exactes iront dans le README de `tv-app/` (avec des adresses d'exemple, rien de réel dans le dépôt).

## 5. Mise à jour

- Même clé de signature à chaque version, sinon `adb install -r` refuse et il faut désinstaller (et réappairer).
  **Clé dédiée** (`homehub-tv.jks`) générée une fois, **gardée hors du dépôt** (gestionnaire de mots de passe ou dépôt
  privé de config du NAS, chiffrée) ; son chemin et ses mots de passe passent par `tv-app/keystore.properties`, ignoré
  par git.
- Mise à jour : `gradlew assembleRelease` puis `adb connect <ip>:5555` et `adb install -r …\homehub-tv.apk`. L'appairage
  et l'adresse sont conservés. Un petit script `tv-app/installer.ps1` enchaîne les trois.
- L'appli montre sa version dans l'écran d'appairage et l'envoie au serveur ; la page des appareils de la tablette
  l'affiche, et signale une appli plus ancienne que le serveur.

## 6. Fonctions et ordre proposé

Retenues (toutes) :

| # | Fonction | Comment | Risque à lever |
|---|---|---|---|
| 1 | Message vocal sans couper la vidéo | Lecture par `MediaPlayer`, focus audio **transitoire avec baisse du son** (`AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`) ; bandeau « Message d'Alex » pendant la lecture | La télé en direct (tuner) et certaines applis ignorent le focus audio : sinon, baisser nous-mêmes le volume puis le rendre |
| 2 | Message écrit en bandeau | Fenêtre par-dessus (`TYPE_APPLICATION_OVERLAY`), texte nettoyé par le serveur (`shared/tv.ts`), `tv.seconds` | Remplace l'appli tierce : la route `/api/tv/message` passe par HomeHub TV si une télé est appairée, sinon par l'appli tierce (`tv.host`), retirée une version plus tard |
| 3 | Alerte du minuteur de cuisine | Le serveur pousse « minuteur fini » ; bandeau + son court ; « Arrêter » à la télécommande arrête le minuteur partout | Le bandeau doit pouvoir prendre le focus de la télécommande sans gêner l'appli en cours |
| 4 | Alerte du bus du matin | Mêmes règles que la tablette (`server/services/transit.ts`) : « Bus dans 5 min » | Plages horaires et jours d'école, pas en vacances |
| 5 | Rappels des routines du soir, nouveaux mots | Bandeau à l'heure prévue (`server/sources/routine-plans.ts`), rien de personnel au-delà de ce que montre déjà la tablette | Ne pas lasser : réglage par rappel |
| 6 | Pause, reprise, volume depuis le téléphone ou la tablette (« À table ! ») | Touches média envoyées au système (`AudioManager.dispatchMediaKeyEvent`), volume par `AudioManager` ; « À table ! » = message + pause | Volume fixe si la télé passe par une barre de son (ARC) : alors pause seulement |
| 7 | État allumée ou éteinte | Présence (attente longue) + écran allumé/éteint (`ACTION_SCREEN_OFF`) ; télé absente ou éteinte → le message vocal part au Google Home, et le téléphone le dit | La veille rapide de certaines télés garde le réseau : se fier à l'écran, pas seulement au réseau |
| 8 | Écran de veille HomeHub (météo, agenda famille, menu du soir) | `DreamService` qui affiche une page HomeHub dédiée (`/ecran`, Svelte, thème sombre) dans une WebView, avec le jeton de la télé | WebView d'Android 10 peut-être ancienne : page simple, sans dernières nouveautés CSS |

Idées en plus, **à classer avec toi** (mon avis entre parenthèses) :

| # | Idée | Avis |
|---|---|---|
| 9 | Parler en direct (WebRTC, comme la 0.66.0) | Utile mais lourd (bibliothèque WebRTC native, plusieurs Mo) : après les autres |
| 10 | Réponses rapides à la télécommande (« OK », « J'arrive ») renvoyées au téléphone | Peu coûteux une fois 2 fait : à faire tôt |
| 11 | Partager une photo ou une vidéo vers la télé | Simple (même chemin que le message vocal) : moyen |
| 12 | Séance de sport guidée sur la télé, lancée depuis le téléphone | Données personnelles affichées sur un écran partagé : seulement sur demande de la personne, à cadrer |
| 13 | Mode cuisine d'une recette | La tablette le fait déjà mieux en cuisine : faible |
| 14 | Alerte pluie | Peu coûteux (météo déjà là) : avec 4 |
| 15 | Mode « film » (annonces renvoyées vers le Google Home) | Peu coûteux une fois 7 fait : avec 7 |
| 16 | Heure du coucher des enfants | Proche de 5 : avec 5 |

**Ordre proposé** (une version par étape) :

1. **Socle** : projet Kotlin, service, appairage, attente longue, présence ; **message vocal atténué (1)** et
   **message écrit (2)** ; destination « Télé » dans l'onglet Caméra du téléphone, parents seulement. ← étape 2 de la
   demande, première version.
2. **Télécommande et retour** : réponses rapides (10), pause/reprise/volume et « À table ! » (6).
3. **État de la télé** : allumée/éteinte, bascule vers le Google Home (7), mode film (15).
4. **Alertes de la maison** : minuteur (3), bus (4), pluie (14).
5. **Soir** : routines, nouveaux mots (5), heure du coucher (16).
6. **Écran de veille HomeHub (8)**, puis partage de photo (11).
7. Plus tard, à décider : parler en direct (9), sport (12), recette (13).

## 7. Première version (après accord sur ce plan)

- Serveur : `screens.ts` (magasin et service), `screen-api.ts`, `access.screen`, destination « Télé » dans
  `cast-api.ts` (vocal) et `tv-api.ts` (écrit), page des appareils de la tablette (section Télé, saisie du code).
- Front : « Ta voix sur » Tablette / **Télé** / appareils Cast dans l'onglet Caméra du téléphone ; bouton « Message à
  la télé » qui passe par l'appli quand elle est là.
- Monde fictif : une fausse télé HomeHub TV (attente longue simulée, comptes rendus) pour les tests et les captures.
- Appli : `tv-app/` minimal (appairage, service, bandeau, lecture atténuée), tests JVM du protocole.
- Tests serveur (`*.test.ts`), README, `docs/ecrans.md` et captures, `TODO.md`, puis version avec `homehub-release`.
- **Fait** quand la version est taguée en local **et essayée sur la vraie télé** avec toi : message vocal pendant
  Netflix, YouTube et la télé en direct (le son baisse-t-il ?), message écrit, télé en veille.

## Questions pour toi

1. Sous-dossier `tv-app/` dans ce dépôt public (proposé) ou dépôt séparé ?
2. Appairage par code affiché sur la télé et tapé sur la tablette (proposé) : d'accord ?
3. Où garder la clé de signature de l'appli (gestionnaire de mots de passe, dépôt privé de config) ?
4. L'ordre des étapes, et le classement des idées 9 à 16.
5. D'accord pour installer les outils listés plus haut (≈ 1 Go à télécharger), au moment de la première version ?
