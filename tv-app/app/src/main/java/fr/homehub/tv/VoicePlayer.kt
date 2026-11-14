// Lecture d'un message vocal sans couper ce qui passe : focus audio transitoire « avec baisse du son »
// (AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK), comme le guidage d'une appli de navigation. Le système baisse lui-même le son
// des applis qui jouent (Android 8 et plus), sans les mettre en pause ; il le remet à la fin. Une appli ou une entrée
// (télé en direct, HDMI) qui ignore le focus audio garde son volume : à vérifier sur la vraie télé.
// Le lecteur en cours est gardé dans un champ : sans référence, le ramasse-miettes le finalisait pendant la lecture
// (ni son ni fin, bandeau affiché pour toujours, 0.69.0). Un garde-fou termine de toute façon la lecture.
package fr.homehub.tv

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import java.io.File

/** Les messages durent 30 s au plus (VOICE_MAX_SECONDS côté téléphone) : garde-fou quand la durée est inconnue. */
const val WATCHDOG_UNKNOWN_MS = 40_000L

/** Marge après la durée annoncée avant de terminer la lecture d'office. */
const val WATCHDOG_MARGIN_MS = 3_000L

/** Délai du garde-fou : durée + 3 s si le lecteur la connaît (> 0), 40 s sinon (MediaPlayer rend -1 ou 0). */
fun watchdogMs(durationMs: Int): Long =
    if (durationMs > 0) durationMs + WATCHDOG_MARGIN_MS else WATCHDOG_UNKNOWN_MS

class VoicePlayer(context: Context) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    /** Lecteur en cours (fil principal seulement), gardé pour que le ramasse-miettes ne le finalise pas. */
    private var current: MediaPlayer? = null

    /**
     * Lit `file` (sur le fil principal). `onStarted` : la lecture a commencé ; `onError` : elle n'a pas pu commencer
     * (raison pour le téléphone) ; `onDone` : fin, échec ou garde-fou, toujours appelé une fois.
     */
    fun play(file: File, onStarted: () -> Unit, onError: (String) -> Unit, onDone: () -> Unit) {
        main.post {
            val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener { }
                .build()
            val player = MediaPlayer()
            current = player
            var finished = false
            lateinit var watchdog: Runnable
            fun finish() {
                if (finished) return
                finished = true
                main.removeCallbacks(watchdog)
                audio.abandonAudioFocusRequest(focus)
                player.release()
                if (current === player) current = null
                onDone()
            }
            watchdog = Runnable { finish() }
            // Avant la préparation aussi : un fichier qui ne se prépare jamais ne bloque pas la file.
            main.postDelayed(watchdog, WATCHDOG_UNKNOWN_MS)
            try {
                player.setAudioAttributes(attributes)
                player.setDataSource(file.absolutePath)
                player.setOnPreparedListener {
                    if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                        // Focus refusé (appel en cours…) : on lit quand même, l'annonce compte plus.
                    }
                    it.start()
                    main.removeCallbacks(watchdog)
                    main.postDelayed(watchdog, watchdogMs(it.duration))
                    onStarted()
                }
                player.setOnCompletionListener { finish() }
                player.setOnErrorListener { _, what, extra ->
                    onError("lecture impossible ($what/$extra)")
                    finish()
                    true
                }
                player.prepareAsync()
            } catch (e: Exception) {
                onError("lecture impossible : ${e.message}")
                finish()
            }
        }
    }
}
