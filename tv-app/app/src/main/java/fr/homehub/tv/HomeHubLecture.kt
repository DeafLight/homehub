// Ce qui passe à la télé (fonction 18) : service d'écoute des notifications, déclaré pour une seule raison, Android ne
// donnant la liste des sessions média (MediaSessionManager.getActiveSessions) qu'à un tel service accordé. Il ne lit
// aucune notification. Accordé par adb (installer.ps1, et par l'appli elle-même dès que son adb local répond :
// Telecommande.kt, `cmd notification allow_listener`). Il suit les sessions (titre, sous-titre, lecture ou pause,
// position, durée, image réduite en JPEG) et prévient HubService à chaque changement, qui renvoie l'état de la télé.
// Règles pures (choix de la session, état, position) : Lecture.kt.
package fr.homehub.tv

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.util.Base64
import java.io.ByteArrayOutputStream

class HomeHubLecture : NotificationListenerService() {
    private val main = Handler(Looper.getMainLooper())
    private var controllers: List<MediaController> = emptyList()
    private val changed = Runnable { listener?.invoke() }

    private val callback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = soon()
        override fun onMetadataChanged(metadata: MediaMetadata?) = soon()
        override fun onSessionDestroyed() = soon()
    }

    private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { list -> follow(list.orEmpty()) }

    /** Un changement prévient HubService un peu plus tard : une appli en envoie souvent plusieurs d'affilée. */
    private fun soon() {
        main.removeCallbacks(changed)
        main.postDelayed(changed, DEBOUNCE_MS)
    }

    private fun follow(list: List<MediaController>) {
        controllers.forEach { runCatching { it.unregisterCallback(callback) } }
        controllers = list
        list.forEach { it.registerCallback(callback, main) }
        soon()
    }

    override fun onListenerConnected() {
        val manager = getSystemService(MediaSessionManager::class.java)
        val me = ComponentName(this, HomeHubLecture::class.java)
        runCatching {
            manager.addOnActiveSessionsChangedListener(sessionsChanged, me, main)
            follow(manager.getActiveSessions(me))
        }
        instance = this
    }

    override fun onListenerDisconnected() {
        instance = null
        runCatching { getSystemService(MediaSessionManager::class.java).removeOnActiveSessionsChangedListener(sessionsChanged) }
        controllers.forEach { runCatching { it.unregisterCallback(callback) } }
        controllers = emptyList()
        soon()
    }

    /** Ce qui passe maintenant, ou null (rien, ou seulement une session en pause d'une appli quittée). */
    private fun current(foreground: String?): Lecture? {
        val list = controllers
        val vues = list.map { SessionVue(it.packageName, it.playbackState?.state ?: 0) }
        val index = choisirSession(vues, foreground) ?: return null
        val c = list[index]
        val playback = c.playbackState ?: return null
        val state = etatLecture(playback.state) ?: return null
        val meta = c.metadata
        return Lecture(
            pkg = c.packageName,
            title = titre(meta?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE), meta?.getString(MediaMetadata.METADATA_KEY_TITLE)),
            subtitle = sousTitre(
                meta?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE),
                meta?.getString(MediaMetadata.METADATA_KEY_ARTIST),
                meta?.getString(MediaMetadata.METADATA_KEY_ALBUM),
            ),
            state = state,
            positionMs = positionActuelle(playback.position, playback.lastPositionUpdateTime, playback.playbackSpeed, state == "playing", SystemClock.elapsedRealtime()),
            durationMs = meta?.let { dureeLecture(it.getLong(MediaMetadata.METADATA_KEY_DURATION)) },
            artwork = meta?.let(::artwork),
        )
    }

    private var lastBitmap: Bitmap? = null
    private var lastArtwork: String? = null

    /** Image du programme réduite à 320 px de large, en JPEG base64 (gardée tant que la session donne la même). */
    private fun artwork(meta: MediaMetadata): String? {
        val bitmap = meta.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: meta.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: meta.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            ?: return null
        if (bitmap === lastBitmap) return lastArtwork
        val encoded = runCatching {
            listOf(320 to 75, 240 to 60).firstNotNullOfOrNull { (width, quality) ->
                val scaled = if (bitmap.width > width) Bitmap.createScaledBitmap(bitmap, width, (bitmap.height * width / bitmap.width).coerceAtLeast(1), true) else bitmap
                val out = ByteArrayOutputStream()
                scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
                Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP).takeIf { it.length <= ARTWORK_MAX }
            }
        }.getOrNull()
        lastBitmap = bitmap
        lastArtwork = encoded
        return encoded
    }

    companion object {
        private const val DEBOUNCE_MS = 400L
        /** Comme NOW_PLAYING_ARTWORK_MAX (shared/now-playing.ts). */
        private const val ARTWORK_MAX = 120_000

        @Volatile var instance: HomeHubLecture? = null
            private set
        /** Prévenu quand ce qui passe change (HubService). */
        @Volatile var listener: (() -> Unit)? = null

        /** Ce qui passe, lu sur le fil principal (les sessions y vivent) ; null sans accès accordé. */
        fun lecture(foreground: String?): Lecture? {
            val service = instance ?: return null
            if (Looper.myLooper() == Looper.getMainLooper()) return service.current(foreground)
            val result = java.util.concurrent.FutureTask { runCatching { service.current(foreground) }.getOrNull() }
            service.main.post(result)
            return runCatching { result.get(2, java.util.concurrent.TimeUnit.SECONDS) }.getOrNull()
        }

        /** Commande adb qui accorde l'accès (installer.ps1 et Telecommande.kt). */
        fun grantCommand(context: Context): String = "cmd notification allow_listener ${context.packageName}/${HomeHubLecture::class.java.name}"

        fun granted(context: Context): Boolean =
            context.getSystemService(NotificationManager::class.java).isNotificationListenerAccessGranted(ComponentName(context, HomeHubLecture::class.java))
    }
}
