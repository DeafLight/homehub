// Lecture d'un message vocal sans couper ce qui passe : focus audio transitoire « avec baisse du son »
// (AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK), comme le guidage d'une appli de navigation. Le système baisse lui-même le son
// des applis qui jouent (Android 8 et plus), sans les mettre en pause ; il le remet à la fin. Une appli ou une entrée
// (télé en direct, HDMI) qui ignore le focus audio garde son volume : à vérifier sur la vraie télé.
package fr.homehub.tv

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import java.io.File

class VoicePlayer(context: Context) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    /**
     * Lit `file` (sur le fil principal). `onStarted` : la lecture a commencé ; `onError` : elle n'a pas pu commencer
     * (raison pour le téléphone) ; `onDone` : fin, ou échec, toujours appelé une fois.
     */
    fun play(file: File, onStarted: () -> Unit, onError: (String) -> Unit, onDone: () -> Unit) {
        main.post {
            val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener { }
                .build()
            val player = MediaPlayer()
            var finished = false
            fun finish() {
                if (finished) return
                finished = true
                audio.abandonAudioFocusRequest(focus)
                player.release()
                onDone()
            }
            try {
                player.setAudioAttributes(attributes)
                player.setDataSource(file.absolutePath)
                player.setOnPreparedListener {
                    if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                        // Focus refusé (appel en cours…) : on lit quand même, l'annonce compte plus.
                    }
                    it.start()
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
