// Réponses rapides à la télécommande (fonction 10) : sous un message écrit ou vocal, le bandeau propose « OK »,
// « J'arrive », « 5 minutes » (QUICK_REPLIES de shared/screen.ts) ; la réponse choisie part à HomeHub
// (POST /api/screen/replies/:replyId), qui la montre au téléphone de l'expéditeur. Règles sans Android, testées sur la
// JVM (ReponsesTest) : réponses et leur texte, corps de la requête, durée du bandeau qui prend la télécommande.
package fr.homehub.tv

import org.json.JSONObject

object Reponses {
    /** Une réponse : sa clé pour HomeHub et son texte sur le bouton. */
    data class Choix(val key: String, val label: String)

    /** Dans l'ordre des boutons ; doit suivre QUICK_REPLIES et QUICK_REPLY_LABELS de shared/screen.ts. */
    val CHOIX = listOf(Choix("ok", "OK"), Choix("coming", "J’arrive"), Choix("five", "5 minutes"))

    /** Un message écrit avec réponses reste au moins ce temps (il faut lire, puis choisir). */
    const val MESSAGE_MIN_MS = 20_000L
    /** Après la fin d'un message vocal, ses réponses restent ce temps à l'écran. */
    const val AFTER_VOICE_MS = 20_000L
    /** À chaque touche sur le bandeau, il reste au moins ce temps (on est en train de choisir). */
    const val IDLE_MS = 15_000L
    /** « Réponse envoyée » reste ce temps, puis le bandeau s'en va et la télécommande revient à l'appli. */
    const val SENT_MS = 2_000L

    /** Corps de la réponse pour HomeHub ; null si la clé n'est pas l'une des réponses. */
    fun replyJson(key: String): String? = CHOIX.firstOrNull { it.key == key }?.let { JSONObject().put("reply", it.key).toString() }

    /** Chemin de la réponse au message `replyId` (identifiant donné par HomeHub, encodé au cas où). */
    fun path(replyId: String): String = "/api/screen/replies/${java.net.URLEncoder.encode(replyId, "UTF-8")}"

    /** Durée d'un message écrit à l'écran : `seconds`, et au moins MESSAGE_MIN_MS s'il propose des réponses. */
    fun messageMs(seconds: Int, withReplies: Boolean): Long {
        val ms = seconds * 1000L
        return if (withReplies) maxOf(ms, MESSAGE_MIN_MS) else ms
    }

    /** Temps restant après une touche : ce qui restait, ou IDLE_MS si c'est plus long. */
    fun afterKeyMs(remainingMs: Long): Long = maxOf(remainingMs, IDLE_MS)

    /** Texte montré une fois la réponse envoyée. */
    fun sentText(key: String): String = "Réponse envoyée : ${CHOIX.firstOrNull { it.key == key }?.label ?: key}"
}
