// Ce qui passe à la télé (fonction 18, shared/now-playing.ts) : règles pures, testées sur la JVM (LectureTest). Quelle
// session média retenir parmi celles d'Android (celle de l'appli au premier plan si elle joue ou est en pause, sinon
// une qui joue), l'état de lecture tel que HomeHub le connaît, la position à l'instant de l'envoi, le sous-titre, le
// JSON envoyé avec l'état de la télé, et la clé qui dit si cela vaut un nouvel envoi. Le service : HomeHubLecture.kt.
package fr.homehub.tv

import org.json.JSONObject

/** Ce qui passe, tel qu'envoyé à HomeHub (ScreenNowPlaying). `artwork` : JPEG en base64 sans préfixe. */
data class Lecture(
    val pkg: String,
    val title: String?,
    val subtitle: String?,
    val state: String,
    val positionMs: Long?,
    val durationMs: Long?,
    val artwork: String?,
)

/** Une session média d'Android, réduite à ce qui sert au choix : son appli et son état (PlaybackState.STATE_*). */
data class SessionVue(val pkg: String, val etat: Int)

object EtatsLecture {
    // Valeurs de android.media.session.PlaybackState, recopiées pour rester testables sur la JVM.
    const val STOPPED = 1
    const val PAUSED = 2
    const val PLAYING = 3
    const val FAST_FORWARDING = 4
    const val REWINDING = 5
    const val BUFFERING = 6
    const val ERROR = 7
    const val CONNECTING = 8
    const val SKIPPING_TO_PREVIOUS = 9
    const val SKIPPING_TO_NEXT = 10
    const val SKIPPING_TO_QUEUE_ITEM = 11
}

/** « playing », « paused », « buffering » ; null pour une session arrêtée, en erreur ou sans état (pas envoyée). */
fun etatLecture(etat: Int): String? = when (etat) {
    EtatsLecture.PLAYING, EtatsLecture.FAST_FORWARDING, EtatsLecture.REWINDING -> "playing"
    EtatsLecture.PAUSED -> "paused"
    EtatsLecture.BUFFERING, EtatsLecture.CONNECTING, EtatsLecture.SKIPPING_TO_PREVIOUS,
    EtatsLecture.SKIPPING_TO_NEXT, EtatsLecture.SKIPPING_TO_QUEUE_ITEM -> "buffering"
    else -> null
}

/**
 * Indice de la session à montrer, ou null. Celle de l'appli au premier plan si elle joue, charge ou est en pause ;
 * sinon la première (Android les donne de la plus prioritaire à la moins) qui joue ou charge : le son d'une appli en
 * arrière-plan passe aussi. Une session en pause d'une appli quittée ne compte plus (film laissé en pause, puis Accueil).
 */
fun choisirSession(sessions: List<SessionVue>, foreground: String?): Int? {
    val devant = sessions.indexOfFirst { it.pkg == foreground && etatLecture(it.etat) != null }
    if (devant >= 0) return devant
    return sessions.indexOfFirst { val e = etatLecture(it.etat); e == "playing" || e == "buffering" }.takeIf { it >= 0 }
}

/**
 * Position à `maintenant` (horloge SystemClock.elapsedRealtime) : celle du dernier relevé de la session, avancée du temps
 * écoulé à sa vitesse quand elle joue. Null si la session ne la donne pas (position négative : inconnue).
 */
fun positionActuelle(position: Long, releve: Long, vitesse: Float, joue: Boolean, maintenant: Long): Long? {
    if (position < 0) return null
    if (!joue || releve <= 0) return position
    return (position + ((maintenant - releve) * vitesse).toLong()).coerceAtLeast(0)
}

/** Durée utile : positive, sinon null (une session en direct annonce 0 ou -1). */
fun dureeLecture(duree: Long): Long? = duree.takeIf { it > 0 }

/** Sous-titre : celui que l'appli affiche, sinon l'artiste (souvent la série ou la chaîne), sinon l'album. */
fun sousTitre(affiche: String?, artiste: String?, album: String?): String? =
    listOf(affiche, artiste, album).firstOrNull { !it.isNullOrBlank() }?.trim()

/** Titre : celui que l'appli affiche, sinon le titre du média. */
fun titre(affiche: String?, titre: String?): String? = listOf(affiche, titre).firstOrNull { !it.isNullOrBlank() }?.trim()

/** Objet `nowPlaying` de l'état envoyé à HomeHub ; JSONObject.NULL quand rien ne passe. */
fun lectureJson(l: Lecture?): Any =
    if (l == null) JSONObject.NULL else JSONObject().apply {
        put("package", l.pkg)
        put("title", l.title ?: JSONObject.NULL)
        put("subtitle", l.subtitle ?: JSONObject.NULL)
        put("state", l.state)
        put("positionMs", l.positionMs ?: JSONObject.NULL)
        put("durationMs", l.durationMs ?: JSONObject.NULL)
        put("artwork", l.artwork ?: JSONObject.NULL)
    }

/**
 * Clé de ce qui passe, pour ne renvoyer l'état qu'au besoin : sans la position, qui avance seule, mais avec son
 * origine (en lecture : l'instant où le programme aurait commencé, à 2 s près) ou, en pause, la position à 2 s près :
 * un saut dans le programme compte, l'écoulement normal non.
 */
fun cleLecture(l: Lecture?, maintenant: Long): String {
    if (l == null) return "-"
    val repere = l.positionMs?.let { if (l.state == "playing") (maintenant - it) / 2_000 else it / 2_000 }
    return listOf(l.pkg, l.title, l.subtitle, l.state, repere, l.durationMs, l.artwork?.hashCode()).joinToString("|")
}
