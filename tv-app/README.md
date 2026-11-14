<!-- Appli Android TV « HomeHub TV » : ce qu'elle fait, outils, construction, installation et mise à jour par adb. -->

# HomeHub TV

Petite appli Android TV, compagnon de HomeHub, installée hors du Play Store par `adb`. Elle reste reliée à HomeHub
(interrogation longue, aucun port ouvert sur la télé) et lit les messages vocaux des parents **par-dessus ce qui passe,
le son du programme baissé**, avec un bandeau « Message d'Alex ». Elle sert aussi de **télécommande** depuis le
téléphone d'un parent (touches, texte, applis, marche/arrêt). Plan et décisions : [`docs/appli-tele.md`](../docs/appli-tele.md).

Kotlin, sans bibliothèque (le système Android suffit) ; Android 10 (API 29) au moins. Version = celle de HomeHub
(`package.json`).

| Fichier | Rôle |
|---|---|
| `MainActivity.kt` | Écran d'accueil : adresse de HomeHub, code d'appairage, état, « Essayer le bandeau » |
| `HubService.kt` | Service au premier plan : événements, téléchargement, lecture, compte rendu |
| `VoicePlayer.kt` | Lecture avec focus audio transitoire « avec baisse du son » |
| `OverlayBanner.kt` | Bandeau par-dessus les autres applis |
| `HubClient.kt`, `Protocol.kt` | Appels HTTP et protocole (`shared/screen.ts` côté serveur) |
| `BootReceiver.kt` | Redémarrage avec la télé et après une mise à jour |
| `AdbProtocol.kt`, `AdbClient.kt` | Client `adb` minimal vers la télé elle-même (`127.0.0.1:5555`) : messages, clé RSA gardée par l'appli, flux `shell:` |
| `Injecteur.kt` | Programme résident lancé par ce flux (`app_process`, identité `shell`) : injecte touches et texte |
| `Remote.kt` | Langage de l'injecteur : noms des touches → codes Android, lignes d'ordre et de réponse |
| `Telecommande.kt` | Garde l'injecteur lancé (relance s'il tombe), touches, texte, veille et réveil, secours sans `adb` |
| `Applis.kt` | Applis du lanceur (nom, paquet, bannière PNG) envoyées à HomeHub, lancement d'une appli |
| `HomeHubAccessibility.kt` | Service d'accessibilité : appli en cours, secours Retour/Accueil |

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

## Mise en place sur la télé (une fois)

1. Paramètres → Préférences de l'appareil → À propos → appuyer 7 fois sur « Build » (options pour développeurs).
2. Options pour développeurs → « Débogage USB » (et « Débogage réseau » / « ADB over network » s'il existe).
3. Depuis le PC : `.\tv-app\installer.ps1 -Tele <ip-de-la-télé> -Serveur http://<adresse-de-homehub>`.
   La télé demande « Autoriser le débogage ? » : cocher « Toujours autoriser » et accepter à la télécommande (puis
   relancer la commande si elle a échoué pendant ce temps).
4. La télé affiche un code : sur la tablette, roue dentée → Téléphones → **Télés**, taper le code et le nom, un
   parent devant la tablette.

Le script installe l'APK, autorise le bandeau (`appops set fr.homehub.tv SYSTEM_ALERT_WINDOW allow`), met l'appli
dans la liste blanche Doze, active son service d'accessibilité et donne l'adresse de HomeHub
(`am start … --es server …`). Une autre adresse plus tard fait oublier l'appairage.

Télécommande : au premier lancement, l'appli se connecte à l'`adb` de la télé elle-même ; la télé demande de nouveau
« Autoriser le débogage ? » (cette fois pour la clé de l'appli) : cocher « Toujours autoriser » et accepter. L'écran
de l'appli dit où en est la télécommande (prête, autorisation attendue, secours seulement). Le « Débogage réseau »
doit rester activé ; pour réveiller la télé éteinte par son Chromecast intégré, « Wake on wireless LAN » aussi.

Liste blanche Doze : à chaque installation ou mise à jour, le script passe
`dumpsys deviceidle whitelist +fr.homehub.tv`, pour qu'Android ne coupe ni le réseau ni le processeur de l'appli
pendant une longue veille ; la télé garde ce réglage après un redémarrage. La commande à la main
(`adb shell dumpsys deviceidle whitelist +fr.homehub.tv`) ne sert qu'après une installation sans le script.

## Mise à jour

`.\tv-app\installer.ps1 -Tele <ip-de-la-télé>` : construit, `adb install -r` (appairage et adresse conservés), relance.
