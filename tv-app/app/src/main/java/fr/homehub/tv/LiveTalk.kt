// Parler en direct (fonction 9, docs/appli-tele.md section 11) : la voix d'un parent, relayée par HomeHub, lue au fur et
// à mesure, son du programme baissé (focus audio transitoire « avec baisse du son »). Format
// de shared/screen-talk.ts : PCM 16 bits, mono, 16 kHz. L'appli demande le son par une attente longue courte
// (GET <audio>?after=n) et reçoit d'un bloc tout ce qui est arrivé depuis ; 410 : le parent a fini. Elle attend 0,3 s de
// son avant de jouer, et jette ce qui dépasse 1 s de retard pour ne pas parler de plus en plus en décalé (TalkPacer,
// pur, testé sur la JVM). Sans bibliothèque : HttpURLConnection et AudioTrack.
package fr.homehub.tv

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack

/** Doivent valoir TALK_RATE et TALK_SEQ_HEADER de shared/screen-talk.ts. */
const val TALK_RATE = 16_000
const val TALK_SEQ_HEADER = "X-HomeHub-Seq"

/** Prise de parole à écouter à `audio` (chemin de l'API) ; `title` : « Alex vous parle ». */
data class TalkEvent(val id: String, val title: String, val audio: String, val rate: Int)

/** Octets de son par seconde (PCM 16 bits mono). */
fun talkBytesPerSecond(rate: Int) = rate * 2

/**
 * Rythme de lecture : rien n'est joué avant `prefillBytes` de son (le réseau a ses hoquets), et un bloc qui dépasse
 * `maxLagBytes` (la télé a pris du retard) ne garde que sa fin. Après un silence du réseau (`gap`), on réattend.
 * Les tailles restent paires (échantillons de 16 bits entiers).
 */
class TalkPacer(private val prefillBytes: Int, private val maxLagBytes: Int) {
    private var waiting = ByteArray(0)

    /** La lecture a commencé (assez de son reçu depuis le début ou le dernier silence). */
    var playing = false
        private set

    /** Son reçu ; renvoie ce qu'il faut jouer maintenant (vide pendant l'attente du début). */
    fun feed(bytes: ByteArray): ByteArray {
        var data = if (playing) bytes else waiting + bytes
        val max = maxLagBytes and 1.inv()
        if (data.size > max) data = data.copyOfRange((data.size - max) and 1.inv(), data.size)
        if (!playing) {
            if (data.size < prefillBytes) {
                waiting = data
                return ByteArray(0)
            }
            playing = true
            waiting = ByteArray(0)
        }
        return data
    }

    /** Rien n'est arrivé depuis un moment : le prochain son attendra de nouveau `prefillBytes`. */
    fun gap() {
        playing = false
        waiting = ByteArray(0)
    }
}

/** Échecs réseau de suite avant d'abandonner (HomeHub arrête de lui-même après 6 s sans nouvelles). */
const val TALK_MAX_FAILURES = 4

class LiveTalkPlayer(context: Context) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    /**
     * Écoute la prise `event` jusqu'à sa fin, sur le fil de l'appelant (bloquant). `onStarted` : son ouvert, prêt à
     * jouer (bandeau, compte rendu) ; une exception avant cela veut dire que le son n'a pas pu s'ouvrir. Renvoie la
     * raison de la fin.
     */
    fun listen(client: HubClient, event: TalkEvent, onStarted: () -> Unit): String {
        val rate = event.rate
        val perSecond = talkBytesPerSecond(rate)
        val minBuffer = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val track = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setBufferSizeInBytes(maxOf(minBuffer, perSecond / 5))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        if (track.state != AudioTrack.STATE_INITIALIZED) {
            track.release()
            throw IllegalStateException("son indisponible")
        }
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            .setWillPauseWhenDucked(false)
            .setOnAudioFocusChangeListener { }
            .build()
        // Focus refusé (appel en cours…) : on joue quand même, la voix du parent compte plus.
        audio.requestAudioFocus(focus)
        var written = 0L
        try {
            onStarted()
            val pacer = TalkPacer(prefillBytes = perSecond * 3 / 10, maxLagBytes = perSecond)
            var after = 0
            var failures = 0
            while (!Thread.currentThread().isInterrupted) {
                val reply = try {
                    client.bytes("${event.audio}?after=$after", TALK_SEQ_HEADER, readTimeoutMs = 15_000)
                } catch (e: HubError) {
                    return e.message ?: "fin"
                } catch (e: InterruptedException) {
                    return "appli arrêtée"
                } catch (e: Exception) {
                    if (++failures >= TALK_MAX_FAILURES) return "HomeHub injoignable"
                    Thread.sleep(300)
                    continue
                }
                failures = 0
                after = reply.header?.toIntOrNull() ?: after
                if (reply.body.isEmpty()) {
                    pacer.gap()
                    continue
                }
                val out = pacer.feed(reply.body)
                if (out.isEmpty()) continue
                if (track.playState != AudioTrack.PLAYSTATE_PLAYING) track.play()
                track.write(out, 0, out.size)
                written += out.size / 2
            }
            return "appli arrêtée"
        } catch (e: InterruptedException) {
            return "appli arrêtée"
        } finally {
            // La fin de la phrase se joue avant de rendre le son (1,5 s au plus).
            runCatching {
                val deadline = System.currentTimeMillis() + 1_500
                while (track.playState == AudioTrack.PLAYSTATE_PLAYING && track.playbackHeadPosition < written && System.currentTimeMillis() < deadline) {
                    Thread.sleep(50)
                }
            }
            runCatching { track.stop() }
            track.release()
            audio.abandonAudioFocusRequest(focus)
        }
    }
}
