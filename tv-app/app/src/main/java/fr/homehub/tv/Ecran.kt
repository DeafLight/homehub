// Adresse de la page de l'écran de veille (fonction 8) : /ecran de HomeHub, avec le jeton de la télé après « # » (lu
// par la page puis retiré de l'adresse, jamais envoyé au serveur dans l'adresse ni écrit dans ses journaux). Fonction
// pure, testée sur la JVM (EcranTest).
package fr.homehub.tv

import java.net.URLEncoder

object Ecran {
    const val PATH = "/ecran"

    /** null tant que l'adresse de HomeHub n'est pas donnée ou que la télé n'est pas appairée. */
    fun url(server: String?, token: String?): String? {
        if (server.isNullOrBlank() || token.isNullOrBlank()) return null
        return server.trimEnd('/') + PATH + "#token=" + URLEncoder.encode(token, "UTF-8")
    }
}
