// Projet Gradle de l'appli Android TV « HomeHub TV » (docs/appli-tele.md) : un seul module, `app`.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "homehub-tv"
include(":app")
