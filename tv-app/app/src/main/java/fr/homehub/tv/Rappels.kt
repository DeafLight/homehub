// Rappels poussés par HomeHub à l'heure réglée (shared/screen-reminders.ts : routine du soir, mots à lire, et plus tard
// l'heure du coucher, icône lune) : lecture des événements « reminder » et durée du bandeau. Fonctions pures, testées sur la JVM
// (RappelsTest) ; l'affichage est dans HubService (bandeau cloche).
package fr.homehub.tv

import org.json.JSONObject

/** Bandeau de rappel : « Routine du soir », « Léa : encore 2 étapes » ; `reminder` : son genre. */
data class ReminderEvent(val id: String, val reminder: String, val title: String, val subtitle: String, val seconds: Int, val discreet: Boolean = false)

/** Rappels parmi les événements reçus (les autres genres sont lus par parseEvents). */
fun parseReminders(json: String): List<ReminderEvent> {
    val list = JSONObject(json).getJSONArray("events")
    return (0 until list.length()).map { list.getJSONObject(it) }.filter { it.optString("kind") == "reminder" }.map {
        ReminderEvent(it.getString("id"), it.optString("reminder"), it.getString("title"), it.optString("subtitle"), it.optInt("seconds", 20), it.optBoolean("discreet"))
    }
}

object Rappels {
    /** Bornes de la durée du bandeau, quoi que demande le serveur. */
    const val MIN_MS = 5_000L
    const val MAX_MS = 60_000L

    fun durationMs(seconds: Int): Long = (seconds * 1_000L).coerceIn(MIN_MS, MAX_MS)

    /** Icône du bandeau : la lune pour l'heure du coucher (fonction 16), sinon celle des rappels (null : la cloche). */
    fun icon(reminder: String): Int? = if (reminder == "bedtime") R.drawable.ic_moon else null
}
