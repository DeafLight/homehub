<!-- Plan de l'appli Android TV « HomeHub TV », compagnon de HomeHub : architecture, outils, mise en place sur la télé,
     mise à jour, ordre des fonctions. À valider avant tout code. -->

# HomeHub TV — appli Android TV (plan validé le 14 novembre 2026)

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
| 17 | Télécommande sur le téléphone (PWA) : flèches, clavier du téléphone, tiroir des applis, lancement, marche/arrêt | Retenue le 14 novembre 2026, détail et essais à faire en section 8 ; reprend presque toute la fonction 6 |

**Ordre proposé : une idée par version**, cochée dans `TODO.md` (section « Télé : appli HomeHub TV ») à sa sortie :

1. **Socle + message vocal atténué (1)** : projet Kotlin, service, appairage, attente longue, présence ;
   destination « Télé » dans l'onglet Caméra du téléphone, parents seulement. Première version.
2. Message écrit en bandeau (2), à la place de l'appli tierce.
3. Réponses rapides à la télécommande (10).
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
  (bouton « Message à la télé » par l'appli) vient à la version suivante.
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
  `access.ts` ; à revoir avec l'heure du coucher (16).
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

## Décisions (14 novembre 2026)

1. Code dans le sous-dossier `tv-app/` de ce dépôt.
2. Appairage par code affiché sur la télé et tapé sur la tablette.
3. Clé de signature dans `%USERPROFILE%\.homehub-tv\`, copie de sauvegarde dans le dossier des secrets du NAS
   (le dépôt privé de config note seulement son emplacement).
4. Ordre : celui proposé ; les idées restantes se choisissent ensuite dans `TODO.md`.
5. Outils installés au moment de la première version.
6. Attente longue plutôt que WebSocket : zéro dépendance, reprise sans perte par numéro d'événement, proxy sans réglage.
   Une WebSocket ne se justifierait que pour des échanges continus (parler en direct, curseur de volume).
