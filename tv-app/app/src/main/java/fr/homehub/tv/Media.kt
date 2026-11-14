// Photo ou vidéo partagée depuis un téléphone (fonction 11, shared/screen-media.ts côté serveur) : lecture des
// événements « media », taille d'affichage d'une photo, délais de fermeture, et le lien entre le service (qui
// télécharge et rend compte) et l'écran plein écran (MediaActivity, qui affiche). Fonctions pures testées sur la JVM
// (MediaTest), sauf MediaSessions.
package fr.homehub.tv

import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch

/** Photo à afficher ou vidéo à lire, à télécharger à `url` (chemin de l'API) ; fermeture au bout de `seconds`. */
data class MediaEvent(val seq: Int, val id: String, val video: Boolean, val title: String, val url: String, val contentType: String, val seconds: Int)

/** Les événements « media » d'une réponse de /api/screen/events (les autres genres sont lus par parseEvents). */
fun parseMediaEvents(json: String): List<MediaEvent> {
    val list = JSONObject(json).getJSONArray("events")
    return (0 until list.length()).map { list.getJSONObject(it) }.filter { it.optString("kind") == "media" }.map {
        MediaEvent(
            it.getInt("seq"),
            it.getString("id"),
            it.getString("media") == "video",
            it.getString("title"),
            it.getString("url"),
            it.getString("contentType"),
            it.optInt("seconds", if (it.getString("media") == "video") MEDIA_VIDEO_MAX_SECONDS else MEDIA_PHOTO_SECONDS),
        )
    }
}

/** Valeurs par défaut de shared/screen-media.ts (SCREEN_PHOTO_SECONDS, SCREEN_VIDEO_MAX_SECONDS). */
const val MEDIA_PHOTO_SECONDS = 60
const val MEDIA_VIDEO_MAX_SECONDS = 300

/** Le bandeau « Photo d'Alex » reste ce temps en haut de la photo, puis s'efface. */
const val MEDIA_TITLE_MS = 5_000L

/** Délai de fermeture d'office : celui du serveur, borné (au moins 5 s, au plus 10 min). */
fun closeDelayMs(seconds: Int): Long = seconds.coerceIn(5, 600) * 1_000L

/**
 * Taille de décodage d'une photo de `width`×`height` pour un écran de `maxWidth`×`maxHeight` : réduite pour tenir
 * dans l'écran, proportions gardées, jamais agrandie (une photo de 12 Mpx décodée entière ne tient pas en mémoire).
 */
fun fitSize(width: Int, height: Int, maxWidth: Int, maxHeight: Int): Pair<Int, Int> {
    if (width <= 0 || height <= 0) return maxWidth to maxHeight
    val scale = minOf(maxWidth.toDouble() / width, maxHeight.toDouble() / height, 1.0)
    return maxOf(1, Math.round(width * scale).toInt()) to maxOf(1, Math.round(height * scale).toInt())
}

/** Extension du fichier téléchargé, d'après l'adresse (« /api/screen/media/abc.jpg » → « jpg »). */
fun mediaExtension(url: String): String = url.substringAfterLast('/').substringAfterLast('.', "").takeIf { Regex("^[a-z0-9]{1,5}$").matches(it) } ?: "bin"

/**
 * Lien entre le service et l'écran plein écran pour un envoi : l'écran dit quand la photo est affichée (ou la vidéo
 * lancée), ou pourquoi il n'a pas pu, puis quand il se ferme. Gardé en mémoire le temps de l'envoi.
 */
class MediaSession(val event: MediaEvent, val path: String) {
    val started = CountDownLatch(1)
    val closed = CountDownLatch(1)
    @Volatile var error: String? = null
        private set

    fun shown() = started.countDown()

    fun failed(reason: String) {
        if (started.count > 0) error = reason
        started.countDown()
    }

    fun close() {
        started.countDown()
        closed.countDown()
    }
}

object MediaSessions {
    private val sessions = ConcurrentHashMap<String, MediaSession>()
    fun put(session: MediaSession) = sessions.put(session.event.id, session)
    fun get(id: String?): MediaSession? = id?.let { sessions[it] }
    fun remove(id: String) = sessions.remove(id)
}
