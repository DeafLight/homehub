<!-- Plan de l'appli Android TV « HomeHub TV », compagnon de HomeHub : architecture, outils, mise en place sur la télé,
     mise à jour, ordre des fonctions. À valider avant tout code. -->

# HomeHub TV — appli Android TV (plan validé le 14 novembre 2026)

Une petite appli installée sur la télé du salon (Android TV 10, installée hors du Play Store par `adb`). Elle reste
connectée à HomeHub et affiche ou fait entendre ce qu'il lui envoie **par-dessus ce qui passe, sans le couper**.

Pourquoi une appli maison : le message vocal de la 0.68 passe par le récepteur Cast, qui prend le premier plan, coupe la
vidéo puis se ferme ; l'appli tierce de la 0.67 pour le message écrit n'affichait que du texte et demandait un port
ouvert sur la télé (retirée en 0.77.0). PiPup est écartée (abandonnée depuis 2019, pas d'APK officiel, pas d'atténuation du son, rien à
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
  perdu). C'est la base de la fonction 7 (basculer vers le Google Home), avec l'écran allumé ou éteint que l'appli
  annonce (`POST /api/screen/state`, `screenOn`) : la veille rapide garde le réseau, la présence seule ne suffit pas.
  Fait : `server/services/screen-fallback.ts` décide (télé allumée : la télé ; en veille, injoignable, ou refus
  « écran éteint » de l'appli : l'appareil de secours de cette télé, réglé sur la tablette, première enceinte par
  défaut) ; le mode film (15) y ajoute sa raison de basculer (`film`, section 13).
- **Télé débranchée depuis moins d'une minute** (0.92.1) : son attente longue meurt sans être fermée, la présence la
  croit là jusqu'à 40 s après la fin des 25 s d'attente. Avant, le message vocal partait vers elle et échouait au bout
  des 20 s de `REPORT_MS` (« La télé n'a pas répondu »), lu nulle part. Maintenant, quand un secours existe, l'envoi
  attend un **accusé de réception** et non le compte rendu : l'appli redemande ses événements avec `after` dès qu'elle
  a lu une réponse, avant même de télécharger le message ; un `after` au moins égal au numéro du message prouve
  qu'elle l'a reçu. Sans accusé au bout de 5 s (`VOICE_RECEIPT_MS`, `missedMs` de `hub.send`), le message est
  **retiré** de sa file et son fichier oublié (`voice.drop`), puis il part sur le secours, raison `silent` : « La
  télé n'a pas répondu : lu sur Google Home du salon ». Pourquoi pas plus court ni basé sur le compte rendu : le
  compte rendu « lecture commencée » arrive après le téléchargement, parfois lent ; basculer sur son absence
  risquerait une double lecture (télé lente qui finit par lire, et Google Home). L'accusé de réception, lui, arrive en
  moins d'une seconde quand l'attente longue est ouverte, et le retrait du message et de son fichier garantit qu'une
  télé qui revient ne le lira pas. Une télé qui a accusé réception mais se tait garde le message : pas de secours
  (« La télé n'a pas répondu » comme avant), plutôt qu'un risque de l'entendre deux fois. Seul cas de double lecture
  restant : télé qui a reçu le message et commencé à le télécharger, mais dont la nouvelle demande met plus de 5 s à
  arriver, très improbable sur le réseau local. Sans secours, rien ne change (attente du compte rendu, 20 s).
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
  `adb shell am start -n fr.homehub.tv/.MainActivity --es server https://homehub.exemple`. Rien de réel dans le dépôt.
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
| `server/cast-api.ts`, `server/tv-api.ts` | Destination « Télé (appli) » du message vocal en plus de Cast ; message écrit |
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

- **Kotlin, vues Android classiques, sans Compose ni AndroidX** : APK d'environ 2 Mo (surtout la bibliothèque Kotlin).
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
- Depuis 0.76.0, la CI construit et signe l'APK à chaque tag (release GitHub, `homehub-tv-X.Y.Z.apk`) et le NAS
  l'installe sur la télé avec le serveur (`tv-app/README.md`, « APK construit par la CI ») ; le SDK local ne sert plus
  qu'à développer et essayer vite.

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
7. **Adresse de HomeHub** : `adb shell am start -n fr.homehub.tv/.MainActivity --es server <adresse>` ; l'appli
   affiche alors le code d'appairage, à taper sur la tablette.
8. **Éviter qu'elle soit tuée** : vérifier qu'elle repart après un redémarrage et une mise en veille ; si le fabricant
   tue les applis en arrière-plan, l'exclure de l'optimisation de batterie
   (`adb shell dumpsys deviceidle whitelist +fr.homehub.tv`). `tv-app/installer.ps1` le fait à chaque installation
   (liste blanche Doze, gardée après un redémarrage) ; la commande à la main ne sert que sans le script.

Les commandes exactes iront dans le README de `tv-app/` (avec des adresses d'exemple, rien de réel dans le dépôt).

## 5. Mise à jour

- Même clé de signature à chaque version, sinon `adb install -r` refuse et il faut désinstaller (et réappairer).
  **Clé dédiée** (`homehub-tv.jks`) générée une fois, **gardée hors du dépôt**, dans le dossier de l'utilisateur
  Windows (`%USERPROFILE%\.homehub-tv\`, avec `keystore.properties` qui donne ses mots de passe) ; une copie de sauvegarde
  dans le dossier des secrets du NAS (lisible par root seul), dont le dépôt privé de config note seulement l'emplacement
  (jamais la clé ni ses mots de passe). Perdre la clé n'est pas grave : il faut désinstaller l'appli et la réappairer.
- Mise à jour : `gradlew assembleRelease` puis `adb connect <ip>:5555` et `adb install -r …\homehub-tv.apk`. L'appairage
  et l'adresse sont conservés. Un petit script `tv-app/installer.ps1` enchaîne les trois.
- L'appli montre sa version dans l'écran d'appairage et l'envoie au serveur ; la page des appareils de la tablette
  l'affiche, et signale une appli plus ancienne que le serveur.

## 6. Fonctions et ordre proposé

Retenues (toutes) :

| # | Fonction | Comment | Risque à lever |
|---|---|---|---|
| 1 | Message vocal sans couper la vidéo | Lecture par `MediaPlayer`, focus audio **transitoire avec baisse du son** (`AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`) ; bandeau « Message d'Alex » pendant la lecture | La télé en direct (tuner) et certaines applis ignorent le focus audio : sinon, baisser nous-mêmes le volume puis le rendre |
| 2 | Message écrit en bandeau | Fenêtre par-dessus (`TYPE_APPLICATION_OVERLAY`), texte nettoyé par le serveur (`shared/tv.ts`), `tv.seconds` | Fait (0.75.0) ; la route `/api/tv/message` ne passe plus que par HomeHub TV depuis la 0.77.0 |
| 3 | Alerte du minuteur de cuisine | Le serveur pousse « minuteur fini » ; bandeau + son court ; « Arrêter » à la télécommande arrête le minuteur partout ; pendant le décompte, petit minuteur en bas à droite sans contrôle (0.79.0) | Le bandeau doit pouvoir prendre le focus de la télécommande sans gêner l'appli en cours |
| 4 | Alerte du bus du matin | Mêmes règles que la tablette (`server/services/transit.ts`) : « Bus dans 5 min » | Plages horaires et jours d'école, pas en vacances |
| 5 | Rappels des routines du soir, nouveaux mots | Bandeau à l'heure prévue (`server/sources/routine-plans.ts`), rien de personnel au-delà de ce que montre déjà la tablette | Ne pas lasser : réglage par rappel |
| 6 | Pause, reprise, volume depuis le téléphone ou la tablette (« À table ! ») | Touches média envoyées au système (`AudioManager.dispatchMediaKeyEvent`), volume par `AudioManager` ; « À table ! » = message + pause | Volume fixe si la télé passe par une barre de son (ARC) : alors pause seulement. **Fait** : par l'injecteur (fonction 17) ou le secours ; bouton **Télé** de la tablette (parent reconnu ou code parent, `screen-media-api.ts`) ; l'appli annonce `volume: fixed` quand `isVolumeFixed` ou qu'une sortie HDMI ARC / eARC existe (`Volume.kt`), le volume est alors grisé et refusé. Le bandeau de « À table ! » passe par `dinnerEvent` (`server/services/screen-media.ts`), point d'accroche du message écrit (fonction 2) |
| 7 | État allumée ou éteinte | Présence (attente longue) + écran allumé/éteint (`ACTION_SCREEN_OFF`) ; télé absente ou éteinte → le message vocal part au Google Home, et le téléphone le dit | La veille rapide de certaines télés garde le réseau : se fier à l'écran, pas seulement au réseau |
| 8 | Écran de veille HomeHub (météo, agenda famille, menu du soir) | `DreamService` qui affiche une page HomeHub dédiée (`/ecran`, Svelte, thème sombre) dans une WebView, avec le jeton de la télé | WebView d'Android 10 peut-être ancienne : page simple, sans dernières nouveautés CSS |

Idées en plus, **à classer avec toi** (mon avis entre parenthèses) :

| # | Idée | Avis |
|---|---|---|
| 9 | Parler en direct (comme la 0.66.0) | Faite sans WebRTC : son relayé par HomeHub, voir section 11 |
| 10 | Réponses rapides à la télécommande (« OK », « J'arrive ») renvoyées au téléphone | Peu coûteux une fois 2 fait : à faire tôt. **Fait** : voir section 12 |
| 11 | Partager une photo ou une vidéo vers la télé | Simple (même chemin que le message vocal) : moyen. **Fait** : cible de partage de la PWA (champ `media`), fichier en mémoire (10 min, 2 places, puis 5 min derrière une adresse au hasard), plein écran `MediaActivity`, routes dans `server/screen-share-api.ts` ; **qui envoie : tout téléphone appairé, enfants compris** (comme montrer son téléphone à la famille ; `access.mediaSender`) ; 50 Mo au plus ; télé en veille refusée |
| 12 | Séance de sport guidée sur la télé, lancée depuis le téléphone | Données personnelles affichées sur un écran partagé : seulement sur demande de la personne, à cadrer |
| 13 | Mode cuisine d'une recette | Fait : vue native, voir section 10 |
| 14 | Alerte pluie | Peu coûteux (météo déjà là) : avec 4 |
| 15 | Mode « film » (annonces renvoyées vers le Google Home) | Fait : voir section 13 |
| 16 | Heure du coucher des enfants | Fait : rappel, pause, écran de veille ; voir section 14 |
| 17 | Télécommande sur le téléphone (PWA) : flèches, clavier du téléphone, tiroir des applis, lancement, marche/arrêt | Retenue le 14 novembre 2026, détail et essais à faire en section 8 ; reprend presque toute la fonction 6 |

**Ordre proposé : une idée par version**, cochée dans `TODO.md` (section « Télé : appli HomeHub TV ») à sa sortie :

1. **Socle + message vocal atténué (1)** : projet Kotlin, service, appairage, attente longue, présence ;
   destination « Télé » dans l'onglet Caméra du téléphone, parents seulement. Première version.
2. Message écrit en bandeau (2).
3. Réponses rapides à la télécommande (10) : fait, section 12.
4. Pause, reprise, volume et « À table ! » (6).
5. Télé allumée ou éteinte, bascule vers le Google Home (7), puis mode film (15).
5 bis. Télécommande sur le téléphone (17), après les essais de la section 8 : tiroir et lancement, puis touches et
   clavier, puis marche/arrêt (qui s'appuie sur 7).
6. Alertes de la maison, une version chacune : minuteur (3), bus (4), pluie (14).
7. Soir, une version chacune : routines et nouveaux mots (5), heure du coucher (16).
8. Écran de veille HomeHub (8), puis partage de photo (11).
9. Plus tard, à décider : parler en direct (9), sport (12), recette (13).

## 7. Première version (après accord sur ce plan) : socle et message vocal

- Serveur : `screens.ts` (magasin et service), `screen-api.ts`, `access.screen`, destination « Télé » dans
  `cast-api.ts` (vocal), page des appareils de la tablette (section Télé, saisie du code).
- Front : « Ta voix sur » Tablette / **Télé** / appareils Cast dans l'onglet Caméra du téléphone. Le message écrit
  (bouton « Message à la télé » par l'appli) vient à la version suivante : fait (fonction 2), événement `message`,
  bandeau `OverlayBanner.showMessage`, compte rendu « Affiché sur la télé ».
- Monde fictif : une fausse télé HomeHub TV (attente longue simulée, comptes rendus) pour les tests et les captures.
- Appli : `tv-app/` minimal (appairage, service, bandeau, lecture atténuée), tests JVM du protocole.
- Tests serveur (`*.test.ts`), README, `docs/ecrans.md` et captures, `TODO.md`, puis version avec `homehub-release`.
- **Fait** quand la version est taguée en local **et essayée sur la vraie télé** avec toi : message vocal pendant
  Netflix, YouTube et la télé en direct (le son baisse-t-il ?), télé en veille.

## 8. Télécommande sur le téléphone (fonction 17)

Un écran de la PWA (`/m`) qui sert de télécommande à la télé : flèches et OK, Retour, Accueil, clavier du téléphone,
tiroir des applis installées, lancement direct, marche/arrêt. Il couvre aussi pause, reprise et volume (fonction 6).

### Comment

| Fonction | Moyen | Difficulté |
|---|---|---|
| Tiroir des applis | L'appli liste les applis du lanceur Android TV (`CATEGORY_LEANBACK_LAUNCHER`, avec `<queries>` pour Android 11) : nom, paquet, bannière en PNG, envoyés au serveur à l'appairage et quand la liste change | Facile |
| Lancer une appli | Événement `launch` ; l'appli démarre l'activité. Android 10+ interdit de lancer un écran depuis l'arrière-plan, sauf aux applis qui ont `SYSTEM_ALERT_WINDOW` : déjà accordé pour le bandeau | Facile |
| Clavier du téléphone | Texte tapé sur le téléphone, écrit dans le champ qui a le focus : par `adb` local (voir plus bas) ou par un service d'accessibilité (`ACTION_SET_TEXT`) | Moyen : YouTube, Netflix ont leur propre clavier à l'écran et n'exposent pas toujours un champ |
| Flèches, OK, Retour, Accueil | Une appli ordinaire ne peut pas envoyer de touches aux autres. Les actions « flèche » de l'accessibilité n'existent qu'à partir d'Android 13 (la télé est en Android 11). Choix : **l'appli se connecte à l'`adb` de la télé elle-même** (`127.0.0.1:5555`, protocole `adb` écrit en Kotlin, sans bibliothèque) et envoie `input keyevent` ; autorisation « Toujours autoriser » acceptée une fois à la télécommande. Secours si `adb` est coupé : accessibilité (Retour, Accueil, focus d'un élément à l'autre, mauvais dans les applis qui dessinent elles-mêmes) | Difficile |
| Éteindre | `KEYCODE_SLEEP` (sinon `KEYCODE_POWER`) par `adb` local ; secours : action « verrouiller l'écran » de l'accessibilité | Facile si `adb` local marche |
| Allumer | En veille, l'appli peut ne plus rien recevoir. Pistes, par ordre : **Cast** (lancer un média sur le Chromecast intégré rallume la télé si « Chromecast toujours disponible » / veille réseau est activé, puis on ferme le récepteur ; HomeHub parle déjà Cast) ; **notre appli** si la veille rapide garde le réseau (`KEYCODE_WAKEUP` par `adb` local) ; **Wake-on-LAN** si la télé le propose (le conteneur doit pouvoir diffuser sur le réseau local) | À essayer |

Écartées : le protocole de la télécommande Google (celui de l'appli Google TV, parlé par le serveur) ne liste pas les
applis et n'est pas documenté officiellement ; HDMI-CEC par la box, que HomeHub ne pilote pas.

- **Réactivité** : une touche fait téléphone → HomeHub → télé. L'attente longue convient à un événement isolé, mais une
  rafale de flèches demande un échange continu : c'est le cas prévu par la décision 6, une WebSocket pour cet écran
  seulement (ou des touches regroupées), à mesurer sur la vraie télé.
- **État** : le bouton marche/arrêt montre allumée, en veille ou injoignable (présence et écran, fonction 7). Télé
  éteinte complètement (veille profonde, prise coupée) : rien ne marche, l'écran le dit.
- **Droits** : parents seulement à la première version (un enfant ne lance pas une appli pendant le film), vérifié par
  `access.ts`. L'heure du coucher (16) ne s'appuie pas sur la télécommande : elle met en pause elle-même, et seul un
  parent la repousse ou l'annule.
- **Rien de personnel** : le tiroir ne montre que des noms d'applis.
- **Mise en place** : `installer.ps1` active le service d'accessibilité
  (`settings put secure enabled_accessibility_services …`) ; la première connexion `adb` locale demande l'autorisation
  à la télécommande.

### Essais à faire sur la vraie télé (avant tout code)

| # | Essai | Ce qu'il décide |
|---|---|---|
| E1 | Redémarrer la télé, puis `adb connect <ip>:5555` depuis le PC : répond-elle encore ? | `adb` local utilisable après un redémarrage, sinon touches par l'accessibilité seulement |
| E2 | Depuis la télé, une connexion à `127.0.0.1:5555` est-elle acceptée (essai avec une appli `adb` locale ou un premier prototype) ? | Choix de l'`adb` local pour les touches, le clavier et la veille |
| E3 | Télé mise en veille à la télécommande, caster un média depuis un téléphone : se rallume-t-elle ? | Allumage par Cast |
| E4 | Télé en veille depuis 5 min puis 1 h : `adb connect` répond-il, l'appli reçoit-elle encore un message ? | Allumage par notre appli (`KEYCODE_WAKEUP`) |
| E5 | Paramètres : « veille réseau », « Chromecast toujours disponible », « Allumer par le réseau » existent-ils ? | Réglages à activer, Wake-on-LAN possible |
| E6 | `adb shell input text` et `ACTION_SET_TEXT` dans la recherche de YouTube, Netflix et de l'appli de la box | Moyen retenu pour le clavier |
| E7 | Rafale de flèches par attente longue (prototype) : délai ressenti | Attente longue suffisante ou WebSocket |

Résultats (14 novembre 2026) :

- **E3 : oui.** Télé en veille, un média casté depuis un téléphone la rallume. **Allumage par Cast retenu.**
- **E5 : « Wake on wireless LAN »** existe et est activé (c'est lui qui rend E3 possible). Le Wake-on-LAN par paquet
  réveil (adresse MAC du Wi-Fi de la télé) reste une piste de secours, inutile tant que Cast suffit.
- **E2, en partie** (Android 11) : `adbd` écoute le port 5555 sur toutes les adresses, et `nc 127.0.0.1 5555` lancé
  sur la télé est accepté. Reste à vérifier, avec un prototype, que l'appli s'y connecte et que la télé accepte son
  autorisation.
- **E7 : touches.** `input keyevent` coûte **environ 1 s par appel** (une machine Java démarrée à chaque fois) : trop
  lent pour des flèches. L'écriture directe dans `/dev/input/event*` est refusée (SELinux), même si `shell` est dans le
  groupe `input`. Avec un **processus qui reste lancé** sous l'identité `shell` (essai avec `monkey --port`), une touche
  fait l'aller-retour PC → télé → PC en 8 à 260 ms, et une rafale de 10 flèches passe en 0,4 s. Il reste à ajouter le
  passage par HomeHub (attente longue).
- **E6 : texte.** L'accessibilité ne voit **aucun champ de saisie** dans Netflix (7 éléments), l'appli de la box
  (110), le Play Store (123), ni YouTube (16, sur l'écran du choix du compte) : `ACTION_SET_TEXT` est écarté. En
  revanche, des touches injectées écrivent dans le champ qui a le focus (essai dans la recherche du Play Store : le mot
  apparaît et les résultats suivent). YouTube et Netflix s'ouvrent sur le choix du profil, que l'essai n'a pas fait à
  la place de la famille : la saisie y reste à essayer.

- **E4 : 5 min, oui.** Télé mise en veille (`KEYCODE_SLEEP`) : à 2 min 30 (Doze `INACTIVE`) puis à 5 min (Doze
  `IDLE`, sommeil profond), `adb` répond, l'appli est vivante et garde sa connexion à HomeHub (liste blanche Doze).
  `KEYCODE_WAKEUP` rallume alors l'écran. Restent l'essai à 1 h et un vrai message vocal envoyé pendant la veille.

- **E7 : passage par HomeHub (0.73).** Dans le monde fictif, une touche fait l'aller-retour téléphone → HomeHub →
  appli → compte rendu en **63 à 84 ms** : l'attente longue suffit, **pas de WebSocket**. Le téléphone groupe une
  rafale : pendant qu'un envoi est en route, les touches suivantes attendent et partent ensemble au suivant (20 au
  plus). Reste la mesure sur la vraie télé.
- **E8 : texte sur la vraie télé (0.73.2).** En 0.73.1, la recherche de YouTube gardait l'ancien texte (le nouveau
  s'ajoutait au bout) et **perdait la deuxième lettre** à chaque essai : l'injecteur envoyait toutes les lettres d'un
  coup, et la première ouvre ou rafraîchit les suggestions. Depuis, l'injecteur **vide d'abord le champ** (curseur au
  bout, puis 40 retours arrière ; Ctrl+A n'est pas pris partout et peut écrire un « a ») et **espace les lettres** :
  0,35 s après le vidage et après la première lettre, 40 ms ensuite (`Typing.plan` dans `Remote.kt`, testé sur la JVM).
  Un mot de 6 lettres prend environ 1,4 s. Reste à vérifier sur la vraie télé.

**Conséquence pour la méthode** : le moyen retenu pour les touches, le texte et la veille est un **petit programme
résident lancé par l'appli à travers son `adb` local**, comme le serveur de scrcpy :
`CLASSPATH=<chemin de l'APK> app_process / fr.homehub.tv.Injecteur`. Il tourne sous l'identité `shell`, qui a le droit
d'injecter des événements (`InputManager.injectInputEvent`), reçoit les touches et le texte par le flux `adb`, et ne
coûte qu'un démarrage (environ 1 s) au lancement de l'appli. L'accessibilité ne sert plus qu'à Retour et Accueil si
`adb` est coupé.
- **E1 : oui.** Après `adb reboot`, `adb` répond de nouveau en 45 s environ (`service.adb.tcp.port=5555` reposé au
  démarrage, `persist.adb.tcp.port` vide). La télé revient **en veille, écran éteint** ; l'appli repart seule
  (service au premier plan) en 1 min 20 s, écran toujours éteint. `input keyevent KEYCODE_WAKEUP` par `adb` la
  rallume aussitôt (écran `ON`) : c'est la touche que l'appli enverra pour « Allumer » quand elle est joignable.

## 9. Séance de sport sur la télé (fonction 12)

Retenue le 15 novembre 2026. Données personnelles sur un écran partagé : seulement à la demande de la personne, depuis
son propre téléphone, et rien de plus que la séance en cours.

- **Droits** : seul le téléphone de la personne (profil avec `fitness: true`) lance, pilote et note sa séance
  (`access.ownPhone` : ni la tablette, ni un parent pour un autre, ni la télé). Une télé prise par la séance de
  quelqu'un d'autre refuse (409).
- **Ce que voit la télé** : le rythme (tours, effort, repos), les six exercices et l'étape en cours avec son temps
  restant (`shared/screen-workout.ts`). Ni prénom, ni numéro de séance, ni palier, ni historique, ni mesures.
- **Horloge** : tenue par le serveur, en mémoire (`server/services/screen-workouts.ts`). La page de la télé la suit
  par interrogation longue (`GET /api/screen/workout?after=rev`) et fait défiler le compte à rebours elle-même, bips
  compris ; le téléphone relit toutes les 3 s.
- **Fin** : finie ou arrêtée, le serveur envoie `workout`/`end` : l'appli ferme la page, vide cache, historique et
  stockage de la WebView, et affiche le bandeau « Séance terminée, Bravo ! » (ou « Séance arrêtée »). Le téléphone
  ouvre la fin de séance habituelle ; la note passe par `POST /api/fitness/sessions`, comme sans la télé.
- **Affichage : page dans une WebView** (`SportActivity`), plutôt qu'une vue native. L'animation du bonhomme
  (`shared/fitness-moves.ts`, dessinée en SVG par `ExerciseAnimation.svelte`) et le minuteur de la séance guidée de la
  tablette (`web/src/lib/workout-timer.ts`) se réutilisent tels quels ; les recopier en Kotlin doublerait le code à
  tenir à jour. La page est une **entrée à part du front** (`web/tele-sport.html`, quelques Ko en plus de la
  bibliothèque commune), sans la tablette ni le téléphone ; mise en page simple (flex, grille, tailles en hauteur
  d'écran). Jeton de la télé passé dans le fragment (`#token=…`, jamais dans une adresse envoyée au serveur), page
  limitée à HomeHub (`Sport.sameOrigin`), son permis sans geste (`setMediaPlaybackRequiresUserGesture(false)`).
- **À essayer sur la vraie télé** : version de la WebView d'Android TV (mise à jour par le Play Store), bips du
  décompte, Retour à la télécommande (ferme la page ; la séance continue sur le téléphone), ouverture par-dessus une
  appli en cours (permise par `SYSTEM_ALERT_WINDOW`, comme le lancement d'une appli de la télécommande).

## 10. Mode cuisine d'une recette (fonction 13)

**Choix : vue native** (`CuisineActivity`, vues Android classiques), plutôt qu'une page dans une WebView :

- rien à partager avec la page `/ecran` de l'écran de veille (fonction 8), développée à part : pas de jeton de télé à
  passer à une page web, pas de seconde route du front à maintenir ;
- le focus de la télécommande est celui des boutons Android (haut/bas, OK), sans rien réimplémenter en JavaScript ;
- la vue est petite (une étape, quelques boutons, une liste de minuteurs) : la mise en page en Kotlin reste courte,
  et rien ne dépend de la version de la WebView d'Android 10.

Même logique que le mode cuisine de la tablette, calculée par le serveur (`shared/screen-cook.ts`) à partir de la
même source de recettes : durées citées par l'étape (`stepDurations`), mode Cookeo, nom du minuteur d'une étape
(`timerLabel`, commun avec la tablette, qui permet de reconnaître le minuteur d'une étape). La télé ne reçoit que ce
qu'elle affiche.

- **Lancement** : « Sur la télé » sur la fiche (tablette, ou téléphone appairé ; rien de personnel dans une recette) →
  `POST /api/screens/:id/cook` → événement `cook` dans l'attente longue → le service ouvre la vue (permis en
  arrière-plan par l'affichage par-dessus les autres applis) et rend compte quand elle est à l'écran. Sinon 502 avec la
  raison, et le mode cuisine d'avant reste.
- **Affichage** : la vue lit `GET /api/screen/cook?after=<rev>` en boucle ; le serveur répond tout de suite si l'étape a
  changé (depuis la fiche, la télécommande), sinon au bout de 5 s, pour reprendre aussi les minuteurs lancés ou arrêtés
  depuis la tablette. Les minuteurs arrivent avec leur temps restant : la télé décompte sans dépendre de son heure.
- **Minuteurs** : ceux de HomeHub (une seule source), lancés par OK sur une durée citée par l'étape (le serveur refuse
  toute autre durée), au nom de qui a lancé le mode cuisine ; la télé ne peut arrêter qu'un minuteur qui sonne (comme
  n'importe qui à la tablette). L'alerte du minuteur fini sur la télé reste la fonction 3.
- **Fin** : Retour (la vue est dans sa propre tâche : la télé revient à ce qui passait), « Arrêter » sur la fiche, ou
  recette retirée. Le mode cuisine vit en mémoire du serveur : un redémarrage l'arrête (la vue se ferme).
## 11. Parler en direct à la télé (fonction 9)

Comme à la tablette en 0.66.0 : un parent appuie sur « Parler en direct » dans l'onglet Caméra de son téléphone, la
télé baisse le son du programme et diffuse sa voix au fur et à mesure, avec le bandeau « Alex vous parle ». Un seul
sens (la télé n'a pas de micro) ; parents seulement, `camera.talk` (`access.talker` dans `server/access.ts`).

### Solutions comparées (15 novembre 2026)

| Solution | Poids dans l'APK | Délai | Pour | Contre |
|---|---|---|---|---|
| Bibliothèque WebRTC native (libwebrtc) | 10 à 20 Mo par architecture | ≈ 0,15 s | Le délai le plus court, comme la tablette | L'APK passe de 2 Mo à plus de 12 ; une bibliothèque, contraire au choix « sans bibliothèque » ; signalisation à réécrire en Kotlin ; TURN pour le dehors |
| WebView avec WebRTC dans l'appli | 0 | ≈ 0,15 s | Reprend le code de la tablette | Une WebView (≈ 100 Mo de mémoire) dans une fenêtre par-dessus, depuis un service ; version de la WebView d'Android TV incertaine (risque déjà noté pour la fonction 8) ; la WebView ne demande pas le focus audio pour un flux WebRTC, il faudrait le faire à côté ; rien de testable sur la JVM ; TURN pour le dehors |
| **Son relayé par HomeHub** | **0** | **≈ 0,4 à 0,6 s** | Kotlin sans bibliothèque (`HttpURLConnection`, `AudioTrack`) ; même chemin que le reste (attente longue, jeton, proxy sans réglage) ; marche aussi hors de la maison sans TURN ; découpage et tampon testés sur la JVM | Un peu plus de délai ; le son passe par le serveur (en mémoire, jamais enregistré) ; ≈ 32 ko/s montants depuis le téléphone |

**Choix : le son relayé par HomeHub.** Pour une annonce à sens unique (« À table ! », « Éteignez, il est l'heure »),
une demi-seconde de délai ne gêne pas : personne ne répond depuis la télé. Les deux autres solutions coûtent soit le
poids et la règle « sans bibliothèque », soit une WebView lourde et intestable pour un simple flux de voix.

### Comment

```
Téléphone ──POST /api/screens/:id/talk──────────────▶ HomeHub ──événement talk──▶ télé : bandeau, son baissé
          ──POST …/talk/:talk/audio?seq=n (0,25 s)──▶  file   ◀──GET /api/screen/talk/:talk?after=n── AudioTrack
          ──DELETE …/talk/:talk────────────────────▶  fin    ──410──────────────▶ bandeau retiré, son rendu
```

- **Format** : PCM 16 bits, mono, 16 kHz (32 ko/s), sans compression : rien à décoder sur la télé, et la voix reste
  claire. Le téléphone prend le micro (`getUserMedia`, suppression d'écho et de bruit), réduit à 16 kHz
  (`web/src/lib/screen-talk.ts`) et envoie un morceau toutes les 0,25 s ; pendant qu'un envoi est en route, la suite
  attend et part avec le suivant (comme les touches de la télécommande).
- **Télé** : l'événement `talk` arrive par l'attente longue habituelle ; l'appli demande le focus audio transitoire avec
  baisse du son (comme le message vocal), ouvre un `AudioTrack` en flux, affiche le bandeau et rend compte. Elle
  demande ensuite le son par une attente longue courte (3 s), `?after=n` : la réponse porte tous les morceaux arrivés
  depuis, d'un bloc. Elle attend 0,3 s de son avant de jouer, et jette ce qui dépasse 1 s de retard (réseau qui a
  hoqueté) pour ne pas parler de plus en plus en décalé (`TalkPacer` dans `LiveTalk.kt`, testé sur la JVM).
- **Fin** : le parent arrête (ou quitte l'onglet), le téléphone n'envoie plus rien depuis 6 s, la télé ne demande
  plus rien depuis 6 s, ou `camera.maxMinutes` est atteint. La télé reçoit 410 et rend le son ; le téléphone, 410 avec
  la raison (« La télé a arrêté d'écouter »).
- **Une voix à la fois** par télé : un second parent reçoit « Sam parle déjà à la télé ».
- **Écran éteint** (fonction 7) : le bouton est grisé sur le téléphone, et l'appli refuse l'événement « écran
  éteint » comme un message vocal ; pas de bascule vers le Google Home, qui ne sait pas lire un flux en direct.
- **Pourquoi pas de WebSocket** (décision 6 l'aurait permis) : l'envoi par morceaux et l'attente longue suffisent à ce
  débit, gardent zéro dépendance côté serveur et passent par le proxy sans réglage. Elle reste possible si le délai
  gêne sur la vraie télé.
- **Rien n'est enregistré** : les morceaux restent en mémoire quelques secondes, le temps que la télé les lise.

### À vérifier sur la vraie télé

Délai ressenti (but : moins d'une seconde), son baissé sous YouTube, Netflix et l'appli de la box, voix claire sur
les haut-parleurs de la télé, depuis le Wi-Fi de la maison puis en 4G.

## 12. Réponses rapides à la télécommande (fonction 10)

Sous un message écrit (fonction 2) ou vocal (fonction 1), le bandeau propose **« OK », « J'arrive », « 5 minutes »**
(`QUICK_REPLIES` de `shared/screen.ts`, recopiées dans `Reponses.kt`) ; la réponse choisie s'affiche sur le téléphone
de l'expéditeur, sous « Affiché sur la télé » ou « Message lu sur … ».

- **Protocole** : compatible avec les applis déjà installées. Les événements `message` et `voice` portent un
  `replyId` facultatif ; une appli plus ancienne l'ignore et affiche le bandeau comme avant. La télé répond par
  `POST /api/screen/replies/:replyId` `{ reply }`.
- **Serveur** (`server/services/screen-replies.ts`, en mémoire) : l'attente de réponse est ouverte à l'envoi, liée à
  l'expéditeur (appareil et profil) et aux télés qui ont **affiché** le message (une télé qui a refusé, ou un message
  parti sur le Google Home de secours, ne propose rien). Réponse acceptée pendant 10 min, une par télé (la dernière fait
  foi). Le téléphone attend par interrogation longue (`GET /api/tv/replies/:id?after=rev`) ; seul l'expéditeur lit
  les réponses. 50 attentes gardées au plus.
- **Bandeau** (`OverlayBanner`) : avec des réponses, la fenêtre devient **focalisable**, comme celle du minuteur
  (fonction 3) : l'appli en cours continue (elle perd seulement le focus de fenêtre), ◀ ▶ et OK vont aux boutons,
  **Retour** masque sans répondre, les touches média et le volume restent au système. Pour ne pas garder la
  télécommande trop longtemps : message écrit au moins 20 s (au lieu de `tv.seconds`), message vocal 20 s après sa
  fin, et chaque touche le garde au moins 15 s. Après le choix : « Réponse envoyée : J'arrive » 2 s, puis le bandeau
  s'en va et la télécommande revient à l'appli.
- **À essayer sur la vraie télé** : voir `TODO.md` (10 bis).

## 13. Mode film (fonction 15)

Pendant un film, une annonce ne doit plus prendre l'écran ni couper le son. Choix du 16 novembre 2026 :

- **Ce qui change** : le **message vocal** part sur l'appareil de secours de la télé (le même que télé éteinte,
  fonction 7, réglage « Si éteinte » de la tablette), raison `film`, et le téléphone affiche « Mode film : lu sur
  Google Home du salon ». Sans appareil de secours, la télé le lit comme avant (son baissé) : mieux qu'un refus. Les
  **bandeaux** (message écrit, minuteur terminé, bus, pluie, rappels, et ce qui s'y ajoutera) partent avec
  `discreet: true` : l'appli montre un petit bandeau en bas à gauche, à demi transparent, sans son, sans prendre la
  télécommande, 5 à 12 s (20 s pour un message écrit). Un minuteur discret n'a ni carillon ni « Arrêter » : la
  tablette sonne toujours. Le Google Home ne lit pas les bandeaux (pas de synthèse vocale dans HomeHub) : discrets
  plutôt que sonores.
- **Ce qui ne change pas** : ce qu'un parent demande exprès (« À table ! », touches, lancement d'une appli, photo
  partagée, mode cuisine, séance de sport) passe comme avant, et le petit décompte des minuteurs reste.
- **Activation automatique** : une appli de films au premier plan, telle que la voit le service d'accessibilité
  (`HomeHubAccessibility`, paquet envoyé dans l'état de la télé). Liste dans `shared/screen-film.ts` : Netflix,
  Disney+, Prime Video, Apple TV, Canal+, Max, Paramount+, Plex, Kodi, VLC. **Pas YouTube** (vidéos courtes,
  dessins animés des enfants, souvent regardé en faisant autre chose) ni l'appli de la box (télé en direct : on ne
  sait pas si c'est un film). Réglage global « Mode film automatique » sur la tablette (Téléphones › Télés ›
  Alertes sur la télé), actif par défaut. Le serveur décide (règle 4 du dépôt) : l'appli n'a rien à savoir du mode.
- **Activation à la main** : bouton **Mode film** sur la télécommande du téléphone d'un parent et dans le panneau
  **Télé** de la tablette (parent reconnu, ou code parent), `PUT /api/screens/:id/film`. Pour un film à la télé en
  direct ou dans une appli absente de la liste. Seulement télé allumée (409 en veille, 503 injoignable).
- **Fin** : automatique, quand l'appli de films n'est plus au premier plan ; à la main, par le même bouton, quand la
  télé se met en veille ou devient injoignable (le film est fini), et au plus tard **4 h** après (un mode oublié ne
  bâillonne pas la télé le lendemain). « Éteindre » à la main pendant Netflix (on veut voir les annonces) vaut tant
  que Netflix reste au premier plan ; ensuite l'automatique reprend. En mémoire du serveur : un redémarrage oublie
  les choix à la main.
- **Code** : règles pures dans `shared/screen-film.ts` ; état et choix dans `server/services/screen-film.ts`
  (guet toutes les 10 s qui oublie les choix des télés éteintes) ; le hub (`services/screens.ts`) ajoute
  `discreet` aux genres concernés (`DISCREET_KINDS`) à l'envoi ; `screen-fallback.ts` bascule avec la raison
  `film`. Appli : `Film.kt` (durées, minuteurs mis à part), `OverlayBanner.showDiscreet`. Aucune autorisation de
  plus sur la télé.
- **À essayer sur la vraie télé** : paquets réels vus par l'accessibilité pour chaque appli (Netflix sur Android TV
  est `com.netflix.ninja`), menu de Netflix et lecture sans changement d'appli (le mode reste), bandeau discret
  lisible à 3 m sans gêner, minuteur discret sans carillon, retour aux bandeaux normaux en quittant l'appli.

## 14. Heure du coucher des enfants (fonction 16)

Trois temps sur les télés allumées, assemblés à partir de fonctions déjà là, sans nouveau mécanisme d'affichage :

| Temps | Quand | Comment |
|---|---|---|
| Rappel | 5 à 30 min avant (15 par défaut) | Événement `reminder` des rappels du soir (fonction 5), genre `bedtime` : bandeau avec une lune (`Rappels.icon`) |
| Pause | À l'heure dite | Touche `pause` avec son bandeau, comme « À table ! » (fonction 6) : « C'est l'heure d'aller au lit », « Bonne nuit Léa et Tom ! » |
| Écran de veille | 0 à 30 min après la pause (10 par défaut) | Événement `bedtime` (`sleep`) : l'appli ouvre `CoucherActivity`, la page `/ecran` de l'écran de veille HomeHub (fonction 8) en plein écran, par-dessus le programme en pause |

- **Réglages** (tablette, parent reconnu, `bedtime.json`) : une heure par soir (17:00 à 22:30, ou aucune) dans deux
  tableaux, **période d'école** et **veilles de vacances**. Le second sert les soirs dont le lendemain est sans école
  pour une autre raison que le week-end (`isNoSchoolDay` : vacances scolaires de la page Vacances, jours fériés) : le
  vendredi qui ouvre les vacances en profite, le dimanche de la rentrée reprend l'heure d'école. Coupé par défaut.
- **Pas un genre de rappel de plus** : les rappels de la fonction 5 n'ont qu'une heure par jour ; le coucher a une
  heure par soir, trois temps et des décisions du soir. Il reprend leur bandeau, leur demi-heure de rattrapage et leur
  envoi aux seules télés allumées (`server/services/bedtime.ts`, règles pures dans `shared/bedtime.ts`).
- **Une fois chacun** : le serveur retient le dernier temps envoyé pour l'heure retenue ce soir. Une télé allumée en
  retard reçoit le dernier temps passé depuis moins d'une demi-heure, seulement (pas de rappel après la pause).
- **Un parent garde la main** (`access.parent` : son téléphone, ou reconnu à la tablette ; jamais un enfant) depuis la
  télécommande du téléphone : repousser d'un quart d'heure (une heure au plus), annuler pour ce soir, rétablir l'heure
  prévue. Les télés allumées l'annoncent en bandeau (« Coucher repoussé à 20:45 », « De la part d'Alex ») et ferment
  l'écran de veille du coucher (`bedtime` / `wake`) s'il était ouvert. Les temps déjà passés à la nouvelle heure ne
  repartent pas d'un coup. Tout s'efface le lendemain.
- **Écran de veille** : une activité de l'appli plutôt que le vrai écran de veille Android, qu'aucune appli ordinaire
  ne peut lancer (`IDreamManager` est réservé au système). Elle ne garde pas l'écran allumé : la mise en veille de la
  télé suit son cours. Retour la ferme (le programme reste en pause), les autres touches sauf le volume ne font rien.
- **À essayer sur la vraie télé** : voir `TODO.md`, 16 bis.

## Décisions (14 novembre 2026)

1. Code dans le sous-dossier `tv-app/` de ce dépôt.
2. Appairage par code affiché sur la télé et tapé sur la tablette.
3. Clé de signature dans `%USERPROFILE%\.homehub-tv\`, copie de sauvegarde dans le dossier des secrets du NAS
   (le dépôt privé de config note seulement son emplacement).
4. Ordre : celui proposé ; les idées restantes se choisissent ensuite dans `TODO.md`.
5. Outils installés au moment de la première version.
6. Attente longue plutôt que WebSocket : zéro dépendance, reprise sans perte par numéro d'événement, proxy sans réglage.
   Une WebSocket ne se justifierait que pour des échanges continus (parler en direct, curseur de volume).
