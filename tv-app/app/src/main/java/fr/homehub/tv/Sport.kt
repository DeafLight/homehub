// Séance de sport guidée sur la télé (fonction 12) : adresse de la page à ouvrir dans la WebView (le jeton de la télé
// dans le fragment, jamais envoyé dans l'adresse au serveur), et garde-fou de navigation (la WebView ne quitte pas
// HomeHub). Fonctions pures, testées sur la JVM (SportTest).
package fr.homehub.tv

import java.net.URLEncoder

object Sport {
    /** Adresse de la page `page` (chemin donné par HomeHub, « /tele-sport.html »), ou null si le chemin est suspect. */
    fun pageUrl(server: String, page: String, token: String): String? {
        if (!Regex("^/[A-Za-z0-9._/-]*$").matches(page) || page.startsWith("//") || page.contains("..")) return null
        return "$server$page#token=${URLEncoder.encode(token, "UTF-8")}"
    }

    /** La WebView ne suit que les adresses de HomeHub (même origine que `server`). */
    fun sameOrigin(server: String, url: String): Boolean = url == server || url.startsWith("$server/") || url.startsWith("$server#")
}
