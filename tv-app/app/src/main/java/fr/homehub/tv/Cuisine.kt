// Mode cuisine d'une recette (fonction 13) : lecture de ce que HomeHub demande d'afficher (shared/screen-cook.ts côté
// serveur), événement « cook » qui ouvre la vue, corps des requêtes (étape, minuteur), décompte des minuteurs sans
// dépendre de l'horloge de la télé, taille du texte de l'étape selon sa longueur, touches de la télécommande. Fonctions
// pures, testées sur la JVM (CuisineTest) ; l'affichage est dans CuisineActivity.
package fr.homehub.tv

import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject

/** Une durée citée par l'étape : « Lancer 25 min », et le minuteur déjà lancé pour elle s'il tourne. */
data class CookDuration(val seconds: Int, val text: String, val timerId: String?)

data class CookStep(val number: Int, val text: String, val section: String?, val mode: String?, val durations: List<CookDuration>)

/** Minuteur de la maison ; `remainingSeconds` : temps restant au moment de la réponse ; `step` : étape de la recette. */
data class CookTimer(val id: String, val label: String, val durationSeconds: Int, val remainingSeconds: Int, val ended: Boolean, val step: Int?)

data class CookView(
    val rev: Int,
    val recipeId: String,
    val title: String,
    val index: Int,
    val total: Int,
    val step: CookStep?,
    val next: String?,
    val timers: List<CookTimer>,
) {
    /** Ce qui change la mise en page (étape, minuteurs lancés ou arrêtés, sonnerie), pas le simple décompte. */
    val layoutKey: String
        get() = listOf(rev, step?.durations?.joinToString { "${it.seconds}:${it.timerId}" }, timers.joinToString { "${it.id}:${it.ended}" }).joinToString("|")
}

/** Ce que fait une touche de la télécommande dans la vue cuisine. */
enum class CookKey { PREVIOUS, NEXT, CLOSE, OTHER }

private fun JSONObject.optText(name: String): String? = if (isNull(name)) null else optString(name).takeIf { it.isNotEmpty() }

/** Réponse de GET /api/screen/cook (et des actions) : `{ "cook": … }`, null quand il n'y a plus de mode cuisine. */
fun parseCookView(json: String): CookView? {
    val o = JSONObject(json).optJSONObject("cook") ?: return null
    val step = o.optJSONObject("step")?.let { s ->
        val list = s.getJSONArray("durations")
        CookStep(
            s.getInt("number"),
            s.getString("text"),
            s.optText("section"),
            s.optText("mode"),
            (0 until list.length()).map { list.getJSONObject(it) }.map { CookDuration(it.getInt("seconds"), it.getString("text"), it.optText("timerId")) },
        )
    }
    val timers: JSONArray = o.getJSONArray("timers")
    return CookView(
        o.getInt("rev"),
        o.getString("recipeId"),
        o.getString("title"),
        o.getInt("index"),
        o.getInt("total"),
        step,
        o.optText("next"),
        (0 until timers.length()).map { timers.getJSONObject(it) }.map {
            CookTimer(it.getString("id"), it.getString("label"), it.getInt("durationSeconds"), it.getInt("remainingSeconds"), it.getBoolean("ended"), if (it.isNull("step")) null else it.getInt("step"))
        },
    )
}

/** Identifiants des événements « ouvrir le mode cuisine » d'une réponse de /api/screen/events. */
fun cookEventIds(json: String): List<String> {
    val list = JSONObject(json).getJSONArray("events")
    return (0 until list.length()).map { list.getJSONObject(it) }.filter { it.optString("kind") == "cook" }.map { it.getString("id") }
}

fun stepJson(index: Int): String = JSONObject().put("index", index.coerceAtLeast(0)).toString()

fun timerJson(seconds: Int): String = JSONObject().put("seconds", seconds).toString()

/** Secondes qui restent, `elapsedMs` après la réponse du serveur (jamais moins de 0). */
fun remainingAfter(timer: CookTimer, elapsedMs: Long): Int = (timer.remainingSeconds - elapsedMs / 1000).toInt().coerceAtLeast(0)

/** « 4:05 », « 1:02:03 ». */
fun cookClock(seconds: Int): String {
    val s = seconds.coerceAtLeast(0)
    val h = s / 3600
    val m = (s % 3600) / 60
    val sec = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%d:%02d".format(m, sec)
}

/** Taille du texte de l'étape (sp) : très grand pour une étape courte, plus petit pour une longue, lisible de loin. */
fun stepTextSize(length: Int): Float = when {
    length <= 80 -> 46f
    length <= 160 -> 40f
    length <= 260 -> 34f
    length <= 400 -> 28f
    else -> 24f
}

/** Flèches gauche/droite : étapes (quel que soit le bouton qui a le focus) ; Retour : quitter. */
fun cookKey(keyCode: Int): CookKey = when (keyCode) {
    KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_MEDIA_REWIND -> CookKey.PREVIOUS
    KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> CookKey.NEXT
    KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> CookKey.CLOSE
    else -> CookKey.OTHER
}
