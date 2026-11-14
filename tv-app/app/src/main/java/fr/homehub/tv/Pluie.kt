// Alerte pluie du matin (fonction 14, server/services/rain-alert.ts côté HomeHub) : lecture des événements « rain » de
// la réponse d'attente longue (shared/screen.ts, ScreenRainEvent). Fonction pure, testée sur la JVM (PluieTest) ; le
// bandeau parapluie est affiché par HubService.
package fr.homehub.tv

import org.json.JSONObject

/** « Pluie vers 8 h » / « Prenez un parapluie », affiché `seconds` secondes. */
data class RainEvent(val id: String, val title: String, val subtitle: String, val seconds: Int)

/** Durée d'affichage gardée entre 5 s et 5 min, quoi que dise le serveur. */
fun rainBannerMs(event: RainEvent): Long = event.seconds.coerceIn(5, 300) * 1000L

/** Les alertes pluie de la réponse ; les autres événements sont lus par parseEvents. */
fun parseRainEvents(json: String): List<RainEvent> {
    val list = JSONObject(json).getJSONArray("events")
    return (0 until list.length()).map { list.getJSONObject(it) }.filter { it.optString("kind") == "rain" }.map {
        RainEvent(it.getString("id"), it.getString("title"), it.optString("subtitle"), it.optInt("seconds", 60))
    }
}
