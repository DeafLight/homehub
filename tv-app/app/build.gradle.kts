// Module de l'appli HomeHub TV. Version reprise de package.json (un seul numéro pour HomeHub et l'appli). Signature de
// la version « release » par la clé de la maison, gardée hors du dépôt : sur le PC,
// %USERPROFILE%\.homehub-tv\keystore.properties (storeFile, storePassword, keyAlias, keyPassword) ; dans la CI, les
// variables HOMEHUB_TV_STORE_FILE, HOMEHUB_TV_STORE_PASSWORD, HOMEHUB_TV_KEY_ALIAS et HOMEHUB_TV_KEY_PASSWORD (tirées
// des secrets GitHub), qui passent avant le fichier. Aucune bibliothèque : le système Android suffit.
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/** « 0.69.0 » lu dans package.json, et son code (0.69.0 → 6900). */
val homehubVersion: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(rootDir.resolve("../package.json").readText())!!.groupValues[1]
val homehubCode: Int = homehubVersion.split('.').map { it.toInt() }.let { (a, b, c) -> a * 1_000_000 + b * 100 + c }

/** Clé de signature : variables d'environnement (CI) sinon keystore.properties (PC), ou rien (APK non signé). */
data class Cle(val storeFile: File, val storePassword: String, val keyAlias: String, val keyPassword: String)

val cle: Cle? = System.getenv("HOMEHUB_TV_STORE_FILE")?.takeIf { it.isNotBlank() }?.let { chemin ->
    fun env(nom: String) = System.getenv(nom)?.takeIf { it.isNotEmpty() } ?: error("$nom manquante")
    Cle(File(chemin), env("HOMEHUB_TV_STORE_PASSWORD"), env("HOMEHUB_TV_KEY_ALIAS"), env("HOMEHUB_TV_KEY_PASSWORD"))
} ?: File(System.getProperty("user.home"), ".homehub-tv/keystore.properties").takeIf { it.exists() }?.let { fichier ->
    val p = Properties().apply { fichier.inputStream().use { load(it) } }
    Cle(File(fichier.parentFile, p.getProperty("storeFile")), p.getProperty("storePassword"),
        p.getProperty("keyAlias"), p.getProperty("keyPassword"))
}

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
        if (cle != null) {
            create("maison") {
                storeFile = cle.storeFile
                storePassword = cle.storePassword
                keyAlias = cle.keyAlias
                keyPassword = cle.keyPassword
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
