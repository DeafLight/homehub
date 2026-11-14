// Service au premier plan qui garde la télé reliée à HomeHub : il attend ses événements par interrogation longue
// (GET /api/screen/events, 25 s côté serveur), télécharge chaque message vocal, le lit son du programme baissé avec le
// bandeau, et rend compte au serveur dès que la lecture commence (ou de l'échec). Les messages passent l'un après
// l'autre. HomeHub injoignable : nouvel essai de plus en plus espacé (jusqu'à 1 min). Télé retirée (401) : jeton
// oublié, l'écran d'accueil propose un nouveau code.
// Télécommande du téléphone : les ordres (touches, texte, appli, marche/arrêt) passent à Telecommande (injecteur par
// l'adb local, ou secours), l'un après l'autre, avec compte rendu. Le service dit à HomeHub où en est la télé (écran
// allumé, appli au premier plan, moyen d'action, adresses) quand cela change, et lui envoie la liste des applis du
// lanceur quand elle change (installation, retrait).
package fr.homehub.tv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.PowerManager
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class HubService : Service() {
    private lateinit var prefs: Prefs
    private lateinit var player: VoicePlayer
    private lateinit var banner: OverlayBanner
    private val playback = Executors.newSingleThreadExecutor()
    /** Ordres de la télécommande, l'un après l'autre (à part des messages vocaux, qui durent). */
    private val remote = Executors.newSingleThreadExecutor()
    /** Envois de l'état et de la liste des applis. */
    private val reports = Executors.newSingleThreadExecutor()
    private lateinit var telecommande: Telecommande
    @Volatile private var running = false
    private var worker: Thread? = null
    @Volatile private var screenOn = true
    @Volatile private var lastState: String? = null
    @Volatile private var lastStateAt = 0L

    /** Écran allumé ou éteint (veille), applis installées ou retirées. */
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_ON -> screenOn = true
                Intent.ACTION_SCREEN_OFF -> screenOn = false
                else -> return sendApps()
            }
            sendState()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        player = VoicePlayer(this)
        banner = OverlayBanner(this)
        screenOn = getSystemService(PowerManager::class.java).isInteractive
        telecommande = Telecommande(this) { sendState() }
        HomeHubAccessibility.listener = { sendState() }
        registerReceiver(receiver, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        })
        registerReceiver(receiver, IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addDataScheme("package")
        })
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        if (!running) {
            running = true
            worker = Thread(::loop, "homehub-events").also { it.start() }
            telecommande.start()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        worker?.interrupt()
        playback.shutdownNow()
        remote.shutdownNow()
        reports.shutdownNow()
        telecommande.stop()
        HomeHubAccessibility.listener = null
        runCatching { unregisterReceiver(receiver) }
        banner.hide()
        super.onDestroy()
    }

    private fun loop() {
        var after: Int? = null
        var backoffMs = 2_000L
        var introduced = false
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
                if (!introduced) {
                    // Première réponse (démarrage, ou HomeHub de retour) : état de la télé et liste des applis.
                    introduced = true
                    sendState(force = true)
                    sendApps()
                }
                events.voices.forEach { event -> playback.execute { handleVoice(server, token, event) } }
                events.remote.forEach { event -> remote.execute { handleRemote(server, token, event) } }
            } catch (e: HubError) {
                introduced = false
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
                introduced = false
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
            // Le lecteur a son garde-fou (40 s au plus) ; si la fin n'arrive quand même pas, le bandeau s'en va.
            if (!done.await(90, TimeUnit.SECONDS)) banner.hide()
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

    /** Un ordre de la télécommande, puis son compte rendu ; l'état est renvoyé s'il a changé (appli, veille). */
    private fun handleRemote(server: String, token: String, event: RemoteEvent) {
        val failure = try {
            when (event) {
                is RemoteEvent.Keys -> {
                    event.notice?.let { notice ->
                        banner.show(notice.title, notice.subtitle, voice = false)
                        Handler(mainLooper).postDelayed({ banner.hide() }, NOTICE_MS)
                    }
                    telecommande.keys(event.keys)
                }
                is RemoteEvent.Text -> telecommande.text(event.text, event.submit)
                is RemoteEvent.Launch -> Applis.launch(this, event.pkg)
                is RemoteEvent.Power -> telecommande.power(event.on)
            }
        } catch (e: Exception) {
            e.message ?: "erreur sur la télé"
        }
        runCatching { HubClient(server, token).call("POST", "/api/screen/events/${event.id}/report", reportJson(failure == null, failure)) }
        if (event is RemoteEvent.Launch || event is RemoteEvent.Power) sendState()
    }

    /** Adresses IPv4 de la télé sur le réseau local (pour que HomeHub retrouve son appareil Cast). */
    private fun addresses(): List<String> = runCatching {
        NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }.filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }
    }.getOrDefault(emptyList())

    /** Envoie l'état de la télé s'il a changé (ou toutes les 5 min, au cas où HomeHub a redémarré). */
    private fun sendState(force: Boolean = false) {
        if (reports.isShutdown) return
        reports.execute {
            prefs.remoteStatus = when (telecommande.etat) {
                Telecommande.Etat.PRET -> getString(R.string.remote_ready)
                Telecommande.Etat.AUTORISATION -> getString(R.string.remote_authorize)
                Telecommande.Etat.ARRET -> getString(R.string.remote_off)
            }
            val server = prefs.server ?: return@execute
            val token = prefs.token ?: return@execute
            val json = stateJson(screenOn, HomeHubAccessibility.foreground, telecommande.control(), addresses())
            val now = System.currentTimeMillis()
            if (!force && json == lastState && now - lastStateAt < STATE_REFRESH_MS) return@execute
            runCatching { HubClient(server, token).call("POST", "/api/screen/state", json) }.onSuccess {
                lastState = json
                lastStateAt = now
            }
        }
    }

    /** Envoie la liste des applis du lanceur si elle a changé depuis le dernier envoi réussi. */
    private fun sendApps() {
        if (reports.isShutdown) return
        reports.execute {
            val server = prefs.server ?: return@execute
            val token = prefs.token ?: return@execute
            val json = appsJson(Applis.list(this))
            val hash = json.hashCode().toString()
            if (hash == prefs.appsSent) return@execute
            runCatching { HubClient(server, token).call("PUT", "/api/screen/apps", json, readTimeoutMs = 30_000) }.onSuccess { prefs.appsSent = hash }
        }
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
        /** Durée du bandeau d'un avis (« À table ! »). */
        private const val NOTICE_MS = 10_000L
        private const val STATE_REFRESH_MS = 5 * 60_000L

        /** Démarre le service si la télé est appairée. */
        fun startIfPaired(context: Context) {
            val prefs = Prefs(context)
            if (prefs.server != null && prefs.token != null) {
                context.startForegroundService(Intent(context, HubService::class.java))
            }
        }
    }
}
