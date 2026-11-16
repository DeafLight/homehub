// Heure du coucher des enfants (fonction 16, shared/bedtime.ts) : lecture des événements « bedtime » (ouvrir l'écran
// de veille du coucher, ou le fermer quand un parent repousse ou annule). Le rappel et la pause arrivent par les
// événements existants (bandeau « reminder », touche pause avec son bandeau). Fonctions pures, testées sur la JVM
// (CoucherTest) ; l'affichage est dans CoucherActivity, ouverte par HubService.
package fr.homehub.tv

import org.json.JSONObject

/** `sleep` : ouvrir l'écran de veille du coucher ; sinon (`wake`) le fermer. */
data class BedtimeEvent(val id: String, val sleep: Boolean)

/** Événements du coucher parmi ceux reçus ; une action inconnue est ignorée. */
fun parseBedtime(json: String): List<BedtimeEvent> {
    val list = JSONObject(json).getJSONArray("events")
    return (0 until list.length()).map { list.getJSONObject(it) }.filter { it.optString("kind") == "bedtime" }.mapNotNull {
        when (it.optString("action")) {
            "sleep" -> BedtimeEvent(it.getString("id"), true)
            "wake" -> BedtimeEvent(it.getString("id"), false)
            else -> null
        }
    }
}

object Coucher {
    /** Attente de l'écran de veille du coucher au premier plan (sous les 8 s qu'attend HomeHub, BEDTIME_REPORT_MS). */
    const val OPEN_MS = 6_000L
}
