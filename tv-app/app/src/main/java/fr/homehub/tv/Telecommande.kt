// Télécommande côté télé : garde l'injecteur lancé par l'adb local (127.0.0.1:5555) et lui passe les ordres reçus de
// HomeHub ; le relance quand le flux tombe (essais de plus en plus espacés, jusqu'à 1 min). Sans adb, un secours sans
// injecteur : Retour et Accueil par l'accessibilité, volume et lecture par AudioManager (ce qu'une appli a le droit de
// faire), veille par l'accessibilité (verrouiller l'écran). Flèches, OK et texte demandent l'injecteur.
package fr.homehub.tv

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.SystemClock
import android.view.KeyEvent

class Telecommande(private val context: Context, private val onChange: () -> Unit) {
    enum class Etat { ARRET, AUTORISATION, PRET }

    @Volatile var etat = Etat.ARRET
        private set
    @Volatile private var running = false
    @Volatile private var stream: AdbConnection.AdbStream? = null
    private val replies = Replies()
    private val audio = context.getSystemService(AudioManager::class.java)

    /** Moyen d'action annoncé à HomeHub (shared/screen.ts, ScreenControl). */
    fun control(): String = when {
        etat == Etat.PRET -> "adb"
        etat == Etat.AUTORISATION -> "authorize"
        HomeHubAccessibility.instance != null -> "accessibility"
        else -> "none"
    }

    fun start() {
        if (running) return
        running = true
        Thread(::loop, "homehub-injecteur").apply { isDaemon = true }.start()
    }

    fun stop() {
        running = false
        stream?.close()
    }

    private fun setEtat(value: Etat) {
        if (etat != value) {
            etat = value
            onChange()
        }
    }

    private fun loop() {
        var backoffMs = 5_000L
        val keys = AdbKeys.loadOrCreate(context.filesDir)
        while (running) {
            val closed = java.util.concurrent.CountDownLatch(1)
            try {
                val connection = AdbConnection.open("127.0.0.1", 5555, keys, "homehub-tv@${Build.MODEL}", onAuthorization = { setEtat(Etat.AUTORISATION) })
                val splitter = LineSplitter { line -> if (parseReply(line) != null) replies.offer(line) }
                replies.clear()
                val opened = connection.openShell(injectorShell(context.applicationInfo.sourceDir), splitter::feed) { closed.countDown() }
                // Démarrage de la machine Java de l'injecteur : environ 1 s, plus sur une télé chargée.
                val first = replies.take(15_000)?.let(::parseReply)
                if (first != InjectorReply.Ready) {
                    opened.close()
                    throw AdbError((first as? InjectorReply.Failed)?.reason ?: "l’injecteur ne démarre pas")
                }
                stream = opened
                setEtat(Etat.PRET)
                backoffMs = 5_000L
                closed.await()
            } catch (_: InterruptedException) {
                break
            } catch (_: Exception) {
                // adb coupé, clé refusée, autorisation pas encore donnée : nouvel essai plus tard.
            }
            stream = null
            setEtat(Etat.ARRET)
            if (!running) break
            SystemClock.sleep(backoffMs)
            backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
        }
    }

    /** Un ordre à l'injecteur ; null si c'est fait, sinon la raison de l'échec. */
    @Synchronized
    private fun order(line: String): String? {
        val current = stream ?: return UNAVAILABLE
        replies.clear()
        return try {
            current.write((line + "\n").toByteArray(Charsets.UTF_8))
            when (val reply = replies.take(4_000)?.let(::parseReply)) {
                InjectorReply.Ok -> null
                is InjectorReply.Failed -> reply.reason
                else -> "l’injecteur ne répond pas"
            }
        } catch (e: Exception) {
            e.message ?: UNAVAILABLE
        }
    }

    /** Touches de la télécommande (noms de shared/screen.ts) ; null si c'est fait, sinon la raison. */
    fun keys(names: List<String>): String? {
        val codes = RemoteKeys.codes(names)
        if (codes.isEmpty()) return null
        if (stream != null) return order(keysLine(codes))
        // Secours, touche par touche ; arrêt à la première qui n’en a pas.
        for (code in codes) fallback(code) ?: return UNAVAILABLE
        return null
    }

    /** Texte écrit dans le champ qui a le focus, puis Entrée si `submit`. */
    fun text(value: String, submit: Boolean): String? {
        if (stream == null) return UNAVAILABLE
        return order(textLine(value)) ?: if (submit) order(keysLine(listOf(RemoteKeys.ENTER))) else null
    }

    /** Allumer (touche de réveil) ou mettre en veille (touche de veille, sinon verrouillage par l'accessibilité). */
    fun power(on: Boolean): String? {
        if (stream != null) return order(keysLine(listOf(if (on) RemoteKeys.WAKEUP else RemoteKeys.SLEEP)))
        if (!on && HomeHubAccessibility.instance?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN) == true) return null
        return UNAVAILABLE
    }

    /** Ce qu'une appli peut faire sans injecteur ; null : pas de secours pour cette touche. */
    private fun fallback(code: Int): Unit? {
        val accessibility = HomeHubAccessibility.instance
        return when (code) {
            RemoteKeys.BACK -> accessibility?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)?.takeIf { it }?.let { }
            RemoteKeys.HOME -> accessibility?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)?.takeIf { it }?.let { }
            RemoteKeys.VOLUME_UP -> audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
            RemoteKeys.VOLUME_DOWN -> audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
            RemoteKeys.VOLUME_MUTE -> audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, AudioManager.FLAG_SHOW_UI)
            RemoteKeys.MEDIA_PLAY_PAUSE, RemoteKeys.MEDIA_PAUSE -> {
                audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
                audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
            }
            else -> null
        }
    }

    companion object {
        const val UNAVAILABLE = "flèches et clavier indisponibles : sur la télé, accepter « Autoriser le débogage ? » (Toujours autoriser)"
    }
}
