# Construit HomeHub TV et l'installe (ou la met à jour) sur la télé par adb, sur le réseau de la maison.
# Première fois : -Serveur donne l'adresse de HomeHub à l'appli et autorise le bandeau (appops).
# À chaque fois : l'appli est mise dans la liste blanche Doze (deviceidle).
#   .\tv-app\installer.ps1 -Tele 192.168.1.50 -Serveur http://192.168.1.10:3000
# Ensuite : .\tv-app\installer.ps1 -Tele 192.168.1.50
# Outils attendus (docs/appli-tele.md) : JDK 17 et SDK Android dans C:\Android, sauf JAVA_HOME / ANDROID_HOME définis.
param(
    [Parameter(Mandatory = $true)][string]$Tele,
    [string]$Serveur,
    [switch]$SansConstruire
)
$ErrorActionPreference = 'Stop'
$ici = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Android\jdk-17' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = 'C:\Android\sdk' }
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
$paquet = 'fr.homehub.tv'

if (-not $SansConstruire) {
    # Gradle déjà téléchargé dans C:\Android s'il y est ; sinon le gradlew du projet (qui le télécharge une fois).
    $gradle = 'C:\Android\gradle-8.11.1\bin\gradle.bat'
    if (-not (Test-Path $gradle)) { $gradle = Join-Path $ici 'gradlew.bat' }
    Push-Location $ici
    try {
        & $gradle --no-daemon -q test assembleRelease
        if ($LASTEXITCODE -ne 0) { throw 'Construction échouée' }
    } finally { Pop-Location }
}
$apk = Get-ChildItem (Join-Path $ici 'app\build\outputs\apk\release') -Filter '*.apk' | Select-Object -First 1
if (-not $apk) { throw 'APK introuvable : clé de signature absente (%USERPROFILE%\.homehub-tv\keystore.properties) ?' }

& $adb connect "${Tele}:5555"
& $adb -s "${Tele}:5555" wait-for-device
& $adb -s "${Tele}:5555" install -r $apk.FullName
if ($LASTEXITCODE -ne 0) { throw 'Installation refusée par la télé' }

# Liste blanche Doze, à chaque fois (sans effet si l'appli y est déjà) : pendant une longue veille, Android ne lui
# coupe ni le réseau ni le processeur. Réglage gardé après un redémarrage de la télé.
Write-Host "Liste blanche Doze : $paquet."
& $adb -s "${Tele}:5555" shell dumpsys deviceidle whitelist "+$paquet"

if ($Serveur) {
    & $adb -s "${Tele}:5555" shell appops set $paquet SYSTEM_ALERT_WINDOW allow
    & $adb -s "${Tele}:5555" shell am start -n "$paquet/.MainActivity" --es server $Serveur
} else {
    & $adb -s "${Tele}:5555" shell am start -n "$paquet/.MainActivity"
}
Write-Host "HomeHub TV $($apk.Name) installée sur $Tele."
