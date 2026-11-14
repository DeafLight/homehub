// Module de l'appli HomeHub TV. Version reprise de package.json (un seul numéro pour HomeHub et l'appli). Signature de
// la version « release » par la clé de la maison, gardée hors du dépôt : %USERPROFILE%\.homehub-tv\keystore.properties
// (storeFile, storePassword, keyAlias, keyPassword). Aucune bibliothèque : le système Android suffit.
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/** « 0.69.0 » lu dans package.json, et son code (0.69.0 → 6900). */
val homehubVersion: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(rootDir.resolve("../package.json").readText())!!.groupValues[1]
val homehubCode: Int = homehubVersion.split('.').map { it.toInt() }.let { (a, b, c) -> a * 1_000_000 + b * 100 + c }

val keystoreFile = File(System.getProperty("user.home"), ".homehub-tv/keystore.properties")
val keystore = Properties().apply { if (keystoreFile.exists()) keystoreFile.inputStream().use { load(it) } }

android {
    namespace = "fr.homehub.tv"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "fr.homehub.tv"
        minSdk = 29
        targetSdk = 35
        versionCode = homehubCode
        versionName = homehubVersion
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("maison") {
                storeFile = File(keystoreFile.parentFile, keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("maison")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        // Appli installée par adb, jamais publiée : pas d'exigences du Play Store.
        disable += setOf("ExpiredTargetSdkVersion", "MissingTranslation")
    }
}

base.archivesName.set("homehub-tv")

dependencies {
    testImplementation("junit:junit:4.13.2")
    // org.json du système n'existe pas dans les tests JVM : la vraie bibliothèque à sa place.
    testImplementation("org.json:json:20240303")
}
