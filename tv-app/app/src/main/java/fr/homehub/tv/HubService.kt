// Service au premier plan qui garde la télé reliée à HomeHub : il attend ses événements par interrogation longue
// (GET /api/screen/events, 25 s côté serveur), télécharge chaque message vocal, le lit son du programme baissé avec le
// bandeau, et rend compte au serveur dès que la lecture commence (ou de l'échec). Les messages passent l'un après
// l'autre. HomeHub injoignable : nouvel essai de plus en plus espacé (jusqu'à 1 min). Télé retirée (401) : jeton
// oublié, l'écran d'accueil propose un nouveau code.
package fr.homehub.tv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class HubService : Service() {
    private lateinit var prefs: Prefs
    private lateinit var player: VoicePlayer
    private lateinit var banner: OverlayBanner
    private val playback = Executors.newSingleThreadExecutor()
    @Volatile private var running = false
    private var worker: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        player = VoicePlayer(this)
        banner = OverlayBanner(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        if (!running) {
            running = true
            worker = Thread(::loop, "homehub-events").also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        worker?.interrupt()
        playback.shutdownNow()
        banner.hide()
        super.onDestroy()
    }

    private fun loop() {
        var after: Int? = null
        var backoffMs = 2_000L
        while (running) {
            val server = prefs.server
            val token = prefs.token
            if (server == null || token == null) break
            try {
                val query = after?.let { "?after=$it" } ?: ""
                val events = parseEvents(HubClient(server, token).call("GET", "/api/screen/events$query", readTimeoutMs = 40_000))
                prefs.status = getString(R.string.status_connected)
                backoffMs = 2_000L
                after = events.last
                events.voices.forEach { event -> playback.execute { handleVoice(server, token, event) } }
            } catch (e: HubError) {
                when (e.status) {
                    401 -> {
                        prefs.forgetPairing()
                        prefs.status = getString(R.string.status_removed)
                        break
                    }
                    else -> {
                        prefs.status = e.message
                        if (!pause(if (e.status == 426) 60_000L else backoffMs)) break
                        backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
                    }
                }
            } catch (e: Exception) {
                prefs.status = getString(R.string.status_unreachable, server)
                if (!pause(backoffMs)) break
                backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
            }
        }
        running = false
        stopSelf()
    }

    private fun pause(ms: Long): Boolean = try {
        Thread.sleep(ms)
        true
    } catch (_: InterruptedException) {
        false
    }

    /** Un message vocal : téléchargement, lecture avec bandeau, compte rendu ; attend la fin avant le suivant. */
    private fun handleVoice(server: String, token: String, event: VoiceEvent) {
        val client = HubClient(server, token)
        val file = File(cacheDir, "message.${event.audio.substringAfterLast('.', "audio")}")
        val report = try {
            client.download(event.audio, file)
            val started = CountDownLatch(1)
            val done = CountDownLatch(1)
            var error: String? = null
            player.play(
                file,
                onStarted = {
                    banner.show(event.title, getString(R.string.banner_subtitle))
                    started.countDown()
                },
                onError = {
                    error = it
                    started.countDown()
                },
                onDone = {
                    banner.hide()
                    done.countDown()
                },
            )
            if (!started.await(15, TimeUnit.SECONDS)) error = "lecture pas commencée au bout de 15 s"
            val result = error?.let { reportJson(false, it) } ?: reportJson(true)
            send(client, event, result)
            done.await(90, TimeUnit.SECONDS)
            null
        } catch (e: InterruptedException) {
            return
        } catch (e: Exception) {
            reportJson(false, "message non téléchargé : ${e.message}")
        }
        report?.let { send(client, event, it) }
        file.delete()
    }

    private fun send(client: HubClient, event: VoiceEvent, report: String) {
        runCatching { client.call("POST", "/api/screen/events/${event.id}/report", report) }
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_MIN))
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_mic)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_text))
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL = "homehub"
        private const val NOTIFICATION_ID = 1

        /** Démarre le service si la télé est appairée. */
        fun startIfPaired(context: Context) {
            val prefs = Prefs(context)
            if (prefs.server != null && prefs.token != null) {
                context.startForegroundService(Intent(context, HubService::class.java))
            }
        }
    }
}
