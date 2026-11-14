<!-- Appli Android TV « HomeHub TV » : ce qu'elle fait, outils, construction (PC et CI), installation et mise à jour par adb. -->

# HomeHub TV

Petite appli Android TV, compagnon de HomeHub, installée hors du Play Store par `adb`. Elle reste reliée à HomeHub
(interrogation longue, aucun port ouvert sur la télé) et lit les messages vocaux des parents **par-dessus ce qui passe,
le son du programme baissé**, avec un bandeau « Message d'Alex », et affiche leurs **messages écrits** en bandeau en
haut de l'écran pendant `tv.seconds` (10 s par défaut), en rendant compte au téléphone. Elle sert aussi de **télécommande** depuis le
téléphone d'un parent (touches, texte, applis, marche/arrêt). Les **minuteurs** de la maison en cours s'y décomptent en petit en bas à droite ; celui qui se termine s'y affiche avec un carillon court ;
« Arrêter » à la télécommande l'arrête partout (tablette, téléphones). L'**alerte du bus du matin** s'y affiche (« Bus dans 9 min », bandeau icône bus pendant 45 s, réglée par
trajet sur la page Transports de la tablette). Le matin, l'**alerte pluie** s'y affiche aussi (bandeau parapluie « Pluie vers 8 h · Prenez un parapluie »). Les **rappels** de HomeHub (routine du soir, mots à lire) s'y affichent à l'heure réglée (bandeau cloche, après un
message vocal en cours). Quand la télé passe en veille d'écran, elle sert d'**écran de veille** (heure, météo, agenda de la
famille, menu du soir). Elle montre aussi **en plein écran** une photo ou une vidéo partagée depuis un téléphone, et la **séance de sport
guidée** lancée depuis le téléphone d'une personne (rien d'autre que la séance en cours ; tout est effacé à la fin).
Plan et décisions : [`docs/appli-tele.md`](../docs/appli-tele.md).

Kotlin, sans bibliothèque (le système Android suffit) ; Android 10 (API 29) au moins. Version = celle de HomeHub
(`package.json`).

| Fichier | Rôle |
|---|---|
| `MainActivity.kt` | Écran d'accueil : adresse de HomeHub, code d'appairage, état, « Essayer le bandeau » |
| `HubService.kt` | Service au premier plan : événements, téléchargement, lecture, message écrit, compte rendu ; écran allumé ou éteint (`ACTION_SCREEN_ON/OFF`) envoyé à HomeHub, message vocal refusé écran éteint (« écran éteint » : HomeHub le fait lire par le Google Home) |
| `VoicePlayer.kt` | Lecture avec focus audio transitoire « avec baisse du son » |
| `OverlayBanner.kt` | Bandeau par-dessus les autres applis : message vocal ou avis (en haut à droite), message écrit (en haut au centre, s'en va seul), alertes du bus et de la pluie (en haut à droite) |
| `Pluie.kt` | Alerte pluie du matin : lecture des événements `rain`, durée du bandeau |
| `HubClient.kt`, `Protocol.kt` | Appels HTTP et protocole (`shared/screen.ts` côté serveur) |
| `BootReceiver.kt` | Redémarrage avec la télé et après une mise à jour |
| `AdbProtocol.kt`, `AdbClient.kt` | Client `adb` minimal vers la télé elle-même (`127.0.0.1:5555`) : messages, clé RSA gardée par l'appli, flux `shell:` |
| `Injecteur.kt` | Programme résident lancé par ce flux (`app_process`, identité `shell`) : injecte touches et texte |
| `Remote.kt` | Langage de l'injecteur : noms des touches → codes Android, lignes d'ordre et de réponse, plan de frappe d'un texte (champ vidé, pauses entre les lettres) |
| `Telecommande.kt` | Garde l'injecteur lancé (relance s'il tombe), touches, texte, veille et réveil, secours sans `adb` |
| `Rappels.kt` | Rappels reçus (`kind: "reminder"`) et durée du bandeau (5 à 60 s) |
| `Applis.kt` | Applis du lanceur (nom, paquet, bannière PNG) envoyées à HomeHub, lancement d'une appli |
| `Media.kt` | Photo ou vidéo partagée : événements « media », taille de décodage, délais, lien service ↔ écran (`MediaSession`) |
| `MediaActivity.kt` | Plein écran : photo (ImageDecoder : orientation, HEIC, GIF animé) ou vidéo (focus audio transitoire), bandeau du titre, Retour ou délai pour fermer |
| `HomeHubAccessibility.kt` | Service d'accessibilité : appli en cours, secours Retour/Accueil |
| `Minuteur.kt` | Minuteurs, sans Android : événements `timer`, `timer-clear` et `timers`, file des minuteurs qui sonnent, décompte à l'heure du serveur, carillon synthétisé |
| `MinuteurDecompte.kt` | Petit décompte des minuteurs en cours en bas à droite, fenêtre non focalisable et non touchable |
| `MinuteurBandeau.kt` | Bandeau du minuteur qui prend le focus de la télécommande (OK : « Arrêter » partout, Retour : masquer), carillon son baissé, compte rendu |
| `HomeHubDream.kt`, `Ecran.kt` | Écran de veille (`DreamService`) : la page `/ecran` de HomeHub dans une WebView, avec le jeton de la télé |
| `SportActivity.kt`, `Sport.kt` | Séance de sport guidée : page de HomeHub (`/tele-sport.html`) en plein écran dans une WebView, ouverte quand la personne la lance depuis son téléphone, fermée et effacée à la fin |

## Minuteurs

Tant qu'un minuteur tourne, le serveur envoie à chaque télé allumée la liste des minuteurs en cours (`timers`, avec
l'heure du serveur `serverNow`), à chaque lancement ou arrêt, et de nouveau quand la télé revient ou que l'appli
redémarre. L'appli montre en petit, en bas à droite, le minuteur le plus proche de la fin (nom, temps restant, « +1 »
s'il y en a d'autres) et décompte seule chaque seconde : l'écart entre `serverNow` et `elapsedRealtime` à la réception
suffit, l'horloge de la télé n'entre pas en jeu. Fenêtre par-dessus `FLAG_NOT_FOCUSABLE | FLAG_NOT_TOUCHABLE` : la
télécommande ne la voit pas, rien n'y est contrôlable. Liste vide, ou plus rien qui tourne : le décompte s'en va.

Quand un minuteur de HomeHub se termine, le serveur envoie `timer` à chaque télé allumée (réglage **Minuteurs** du
panneau Télés de la tablette). Le bandeau s'affiche en haut à droite et **prend le focus de la télécommande** : c'est
une fenêtre par-dessus (`TYPE_APPLICATION_OVERLAY`) focalisable, sans `FLAG_NOT_FOCUSABLE`. L'appli en cours ne passe
pas en pause (elle perd seulement le focus de fenêtre) ; flèches, OK et Retour vont au bandeau tant qu'il est là, les
touches média et le volume restent au système. **OK** appelle `POST /api/screen/timers/:id/stop` : le minuteur
s'arrête sur la tablette, les téléphones et les autres télés (`timer-clear`). **Retour** masque le bandeau sur cette
télé seulement. Sans geste, il s'en va au bout de 10 min. Plusieurs minuteurs : le dernier arrivé s'affiche, les autres
reviennent quand il s'en va. Carillon : trois notes synthétisées (`AudioTrack`, aucun fichier), focus audio transitoire
avec baisse du son, comme un message vocal. À vérifier sur la vraie télé : que les applis vidéo continuent bien quand le
bandeau prend le focus.

## Outils (PC Windows)

Dans `C:\Android` : JDK 17 (`jdk-17`), SDK Android (`sdk` : `platform-tools`, plateforme et build-tools 35), Gradle
8.11.1 (`gradle-8.11.1`). `tv-app/local.properties` (ignoré par git) : `sdk.dir=C:/Android/sdk`.

Clé de signature : `%USERPROFILE%\.homehub-tv\homehub-tv.jks` et `keystore.properties` (`storeFile`, `storePassword`,
`keyAlias`, `keyPassword`), **hors du dépôt**. Une copie de sauvegarde est gardée dans le dossier des secrets du NAS
(lisible par root seul) ; le dépôt privé de config du NAS ne contient pas la clé, il note seulement où est cette copie.
Sans la même clé, une mise à jour est refusée : il faut désinstaller puis réappairer.

```powershell
$env:JAVA_HOME = 'C:\Android\jdk-17'
C:\Android\gradle-8.11.1\bin\gradle.bat -p tv-app test assembleRelease   # APK : tv-app\app\build\outputs\apk\release
```

## APK construit par la CI

À chaque tag `vX.Y.Z`, le workflow `release` (job `tv-apk`) lance les tests, construit l'APK signé par la même clé
et l'attache à la release GitHub du tag : `homehub-tv-X.Y.Z.apk`. Le NAS le télécharge de là pour l'installer sur la
télé (script `deploy-homehub.sh` du dépôt de config du NAS, qui refait les étapes d'`installer.ps1`). La construction
sur le PC reste possible et donne un APK signé par la même clé.

La clé arrive dans la CI par quatre secrets du dépôt, que `app/build.gradle.kts` lit en variables d'environnement
(`HOMEHUB_TV_STORE_FILE` et suivantes, prioritaires sur `keystore.properties`). Ils se créent **une fois**, depuis le
PC qui garde la clé, par son propriétaire (`gh auth login` fait) ; les valeurs ne s'affichent pas :

```powershell
$d = "$env:USERPROFILE\.homehub-tv"
$p = Get-Content "$d\keystore.properties" -Raw | ConvertFrom-StringData
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $d $p.storeFile)))
gh secret set HOMEHUB_TV_KEYSTORE_B64   -R DeafLight/homehub --body $b64
gh secret set HOMEHUB_TV_STORE_PASSWORD -R DeafLight/homehub --body $p.storePassword
gh secret set HOMEHUB_TV_KEY_ALIAS      -R DeafLight/homehub --body $p.keyAlias
gh secret set HOMEHUB_TV_KEY_PASSWORD   -R DeafLight/homehub --body $p.keyPassword
Remove-Variable p, b64
gh secret list -R DeafLight/homehub     # les quatre noms, sans les valeurs
```

Changer de clé, c'est refaire ces quatre commandes (et désinstaller puis réappairer sur la télé). La CI vérifie la
signature (`apksigner verify --print-certs`, empreinte du certificat dans le journal du job) ; sans secret, le job
échoue au lieu de publier un APK non signé.

## Mise en place sur la télé (une fois)

1. Paramètres → Préférences de l'appareil → À propos → appuyer 7 fois sur « Build » (options pour développeurs).
2. Options pour développeurs → « Débogage USB » (et « Débogage réseau » / « ADB over network » s'il existe).
3. Depuis le PC : `.\tv-app\installer.ps1 -Tele <ip-de-la-télé> -Serveur http://<adresse-de-homehub>`.
   La télé demande « Autoriser le débogage ? » : cocher « Toujours autoriser » et accepter à la télécommande (puis
   relancer la commande si elle a échoué pendant ce temps).
4. La télé affiche un code : sur la tablette, roue dentée → Téléphones → **Télés**, taper le code et le nom, un
   parent devant la tablette.

Le script installe l'APK, autorise le bandeau (`appops set fr.homehub.tv SYSTEM_ALERT_WINDOW allow`), met l'appli
dans la liste blanche Doze, active son service d'accessibilité, choisit son écran de veille et donne l'adresse de HomeHub
(`am start … --es server …`). Une autre adresse plus tard fait oublier l'appairage.

Télécommande : au premier lancement, l'appli se connecte à l'`adb` de la télé elle-même ; la télé demande de nouveau
« Autoriser le débogage ? » (cette fois pour la clé de l'appli) : cocher « Toujours autoriser » et accepter. L'écran
de l'appli dit où en est la télécommande (prête, autorisation attendue, secours seulement). Le « Débogage réseau »
doit rester activé ; pour réveiller la télé éteinte par son Chromecast intégré, « Wake on wireless LAN » aussi.

Liste blanche Doze : à chaque installation ou mise à jour, le script passe
`dumpsys deviceidle whitelist +fr.homehub.tv`, pour qu'Android ne coupe ni le réseau ni le processeur de l'appli
pendant une longue veille ; la télé garde ce réglage après un redémarrage. La commande à la main
(`adb shell dumpsys deviceidle whitelist +fr.homehub.tv`) ne sert qu'après une installation sans le script.

Écran de veille : à chaque installation, le script passe
`settings put secure screensaver_components fr.homehub.tv/.HomeHubDream` et `screensaver_enabled 1`. Le délai avant
la veille reste celui de la télé (Paramètres → Préférences de l'appareil → Économiseur d'écran, selon le fabricant) ;
le même menu permet de revenir à l'écran de veille d'origine. Télé pas encore appairée : l'écran de veille le dit. La
page vient de HomeHub (`/ecran`) : une nouvelle version de HomeHub la met à jour sans réinstaller l'appli.

Photo ou vidéo partagée : l'écran plein écran s'ouvre par-dessus l'appli en cours grâce à l'autorisation « afficher
par-dessus » (déjà donnée par le script) ; télé en veille, l'envoi est refusé. Une vidéo prend un focus audio
**transitoire** : l'appli en cours se met en pause (ou baisse le son) et reprend à la fermeture ; la télé en direct
(tuner, HDMI) peut l'ignorer, à vérifier sur la vraie télé.

## Mise à jour

- Depuis le NAS, avec le serveur (cas normal) : `sudo scripts/deploy-homehub.sh` installe l'APK de la release de la
  version déployée (`--tele-seulement` pour la télé seule). La première fois, la télé demande d'autoriser la clé
  `adb` du NAS : « Toujours autoriser », puis relancer.
- Depuis le PC : `.\tv-app\installer.ps1 -Tele <ip-de-la-télé>` : construit, `adb install -r` (appairage et adresse
  conservés), relance.
