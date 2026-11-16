// Service au premier plan qui garde la télé reliée à HomeHub : il attend ses événements par interrogation longue
// (GET /api/screen/events, 25 s côté serveur), télécharge chaque message vocal, le lit son du programme baissé avec le
// bandeau, et rend compte au serveur dès que la lecture commence (ou de l'échec). Les messages passent l'un après
// l'autre ; écran éteint (veille), un message est refusé pour que HomeHub le fasse lire par le Google Home (fonction
// 7). HomeHub injoignable : nouvel essai de plus en plus espacé (jusqu'à 1 min). Télé retirée (401) : jeton
// oublié, l'écran d'accueil propose un nouveau code.
// Télécommande du téléphone : les ordres (touches, texte, appli, marche/arrêt) passent à Telecommande (injecteur par
// l'adb local, ou secours), l'un après l'autre, avec compte rendu. Le service dit à HomeHub où en est la télé (écran
// allumé, appli au premier plan, moyen d'action, adresses) quand cela change, et lui envoie la liste des applis du
// lanceur quand elle change (installation, retrait).
// Minuteurs (fonction 3) : petit décompte en bas à droite tant qu'il en tourne (sans contrôle à la télécommande), puis
// à la fin bandeau qui prend la télécommande, carillon, « Arrêter » (MinuteurAlertes).
// Rappels (routine du soir, mots à lire) : bandeau cloche pendant la durée demandée, après le message vocal en cours.
// Volume réglable ou fixe (barre de son par HDMI ARC, Volume.kt) : annoncé avec l'état, renvoyé quand une sortie
// audio apparaît ou disparaît.
// Photo ou vidéo partagée depuis un téléphone : téléchargée puis montrée en plein écran (MediaActivity), compte rendu.
// Séance de sport (fonction 12) : la page de la séance s'ouvre dans SportActivity, et se ferme à la fin.
// Mode cuisine d'une recette (fonction 13) : ouvre la vue cuisine (CuisineActivity).
// Parler en direct (fonction 9) : l'événement `talk` ouvre le son (LiveTalk.kt), affiche « Alex vous parle » et rend
// compte ; la voix arrive ensuite par sa propre attente longue, jusqu'à la fin de la prise de parole.
// Réponses rapides (fonction 10) : sous un message écrit ou vocal qui porte un `replyId`, le bandeau propose « OK »,
// « J'arrive », « 5 minutes » à la télécommande ; la réponse choisie part à HomeHub (POST /api/screen/replies/:id).
// Mode film (fonction 15) : les bandeaux marqués `discreet` par HomeHub (message, minuteur, bus, pluie, rappel) passent
// en petit en bas à gauche, sans son ni focus (Film.kt) ; les messages vocaux, eux, partent sur le Google Home.
// Heure du coucher (fonction 16) : le rappel et la pause arrivent comme les autres bandeaux et touches ; l'événement
// « bedtime » ouvre l'écran de veille du coucher (CoucherActivity), ou le ferme si un parent repousse ou annule.
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
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
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
    private lateinit var minuteurs: MinuteurAlertes
    private val playback = Executors.newSingleThreadExecutor()
    /** Ordres de la télécommande, l'un après l'autre (à part des messages vocaux, qui durent). */
    private val remote = Executors.newSingleThreadExecutor()
    /** Rappels, l'un après l'autre (chacun attend la fin d'un message vocal en cours). */
    private val rappels = Executors.newSingleThreadExecutor()
    /** Un message vocal est en cours : son bandeau ne doit pas être remplacé par un rappel. */
    @Volatile private var speaking = false
    /** Fin du bandeau du dernier rappel (annulée si un autre rappel le remplace). */
    private val hideReminder = Runnable { banner.hide() }
    /** Photos et vidéos partagées, l'une après l'autre (une nouvelle ferme la précédente). */
    private val media = Executors.newSingleThreadExecutor()
    /** Envois de l'état et de la liste des applis. */
    private val reports = Executors.newSingleThreadExecutor()
    private lateinit var telecommande: Telecommande
    private lateinit var talker: LiveTalkPlayer
    /** Prises de parole en direct, l'une après l'autre (à part des messages et de la télécommande). */
    private val talks = Executors.newSingleThreadExecutor()
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

    /** Barre de son branchée ou débranchée (sortie HDMI ARC) : le volume peut passer de réglable à fixe. */
    private val audioDevices = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = sendState()
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = sendState()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** Volume de la télé pour HomeHub (fonction 6). */
    private fun volume(): String {
        val audio = getSystemService(AudioManager::class.java)
        return volumeMode(audio.isVolumeFixed, audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type })
    }

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        player = VoicePlayer(this)
        banner = OverlayBanner(this)
        minuteurs = MinuteurAlertes(this, prefs)
        talker = LiveTalkPlayer(this)
        screenOn = getSystemService(PowerManager::class.java).isInteractive
        telecommande = Telecommande(this) { sendState() }
        HomeHubAccessibility.listener = { sendState() }
        HomeHubLecture.listener = { sendState() }
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
        getSystemService(AudioManager::class.java).registerAudioDeviceCallback(audioDevices, Handler(mainLooper))
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
        rappels.shutdownNow()
        media.shutdownNow()
        MediaActivity.closeCurrent()
        talks.shutdownNow()
        reports.shutdownNow()
        telecommande.stop()
        HomeHubAccessibility.listener = null
        HomeHubLecture.listener = null
        runCatching { unregisterReceiver(receiver) }
        getSystemService(AudioManager::class.java).unregisterAudioDeviceCallback(audioDevices)
        banner.hide()
        minuteurs.stop()
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
                val json = HubClient(server, token).call("GET", "/api/screen/events$query", readTimeoutMs = 40_000)
                val events = parseEvents(json)
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
                events.messages.forEach { event -> remote.execute { handleMessage(server, token, event) } }
                minuteurs.running(parseRunningTimers(json))
                val (timers, quietTimers) = Film.splitTimers(parseTimerEvents(json))
                minuteurs.handle(timers)
                quietTimers.forEach { event -> remote.execute { handleQuietTimer(server, token, event) } }
                events.bus.forEach { event -> remote.execute { handleBus(server, token, event) } }
                parseRainEvents(json).forEach { event -> remote.execute { handleRain(server, token, event) } }
                parseReminders(json).forEach { event -> rappels.execute { handleReminder(server, token, event) } }
                val shared = parseMediaEvents(json)
                // Une nouvelle photo ferme celle à l'écran : la file passe aussitôt à la suivante.
                if (shared.isNotEmpty()) MediaActivity.closeCurrent()
                shared.forEach { event -> media.execute { handleMedia(server, token, event) } }
                cookEventIds(json).forEach { id -> remote.execute { openCook(server, token, id) } }
                events.talks.forEach { event -> talks.execute { handleTalk(server, token, event) } }
                parseBedtime(json).forEach { event -> remote.execute { handleBedtime(server, token, event) } }
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

    /**
     * Un message vocal : téléchargement, lecture avec bandeau, compte rendu ; attend la fin avant le suivant. Écran
     * éteint : refusé sans le télécharger (HomeHub le fait lire par le Google Home), et l'état est renvoyé.
     */
    private fun handleVoice(server: String, token: String, event: VoiceEvent) {
        val client = HubClient(server, token)
        screenOn = getSystemService(PowerManager::class.java).isInteractive
        voiceRefusal(screenOn)?.let {
            send(client, event, it)
            sendState()
            return
        }
        val file = File(cacheDir, "message.${event.audio.substringAfterLast('.', "audio")}")
        speaking = true
        val report = try {
            client.download(event.audio, file)
            val started = CountDownLatch(1)
            val done = CountDownLatch(1)
            var error: String? = null
            player.play(
                file,
                onStarted = {
                    banner.show(event.title, getString(R.string.banner_subtitle), onReply = replier(server, token, event.replyId))
                    started.countDown()
                },
                onError = {
                    error = it
                    started.countDown()
                },
                onDone = {
                    // Réponses pas encore choisies : elles restent un moment après la fin du message.
                    banner.hideOrWait()
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
            speaking = false
            return
        } catch (e: Exception) {
            reportJson(false, "message non téléchargé : ${e.message}")
        }
        report?.let { send(client, event, it) }
        file.delete()
        speaking = false
    }

    /** Un rappel : bandeau cloche (après le message vocal en cours), compte rendu, puis bandeau retiré à la fin de sa durée. */
    private fun handleReminder(server: String, token: String, event: ReminderEvent) {
        val deadline = System.currentTimeMillis() + Rappels.WAIT_VOICE_MS
        while (speaking && System.currentTimeMillis() < deadline) if (!pause(500)) return
        if (event.discreet) {
            Handler(mainLooper).removeCallbacks(hideReminder)
            val quiet = banner.showDiscreet(event.title, event.subtitle, R.drawable.ic_bell, Film.durationMs(event.seconds))
            val answer = if (quiet) reportJson(true) else reportJson(false, "autorisation « afficher par-dessus » manquante")
            runCatching { HubClient(server, token).call("POST", "/api/screen/events/${event.id}/report", answer) }
            return
        }
        val shown = banner.show(event.title, event.subtitle, voice = false, icon = Rappels.icon(event.reminder))
        if (shown) {
            val main = Handler(mainLooper)
            main.removeCallbacks(hideReminder)
            main.postDelayed(hideReminder, Rappels.durationMs(event.seconds))
        }
        val report = if (shown) reportJson(true) else reportJson(false, "autorisation « afficher par-dessus » manquante")
        runCatching { HubClient(server, token).call("POST", "/api/screen/events/${event.id}/report", report) }
    }

    private fun send(client: HubClient, event: VoiceEvent, report: String) {
        runCatching { client.call("POST", "/api/screen/events/${event.id}/report", report) }
    }

    /** Une prise de parole en direct : son ouvert, bandeau et compte rendu, puis la voix jusqu'à la fin. */
    private fun handleTalk(server: String, token: String, event: TalkEvent) {
        val client = HubClient(server, token)
        val report = { json: String -> runCatching { client.call("POST", "/api/screen/events/${event.id}/report", json) } }
        // Écran éteint : personne n'entendrait, refus comme pour un message vocal (le téléphone grise déjà le bouton).
        voiceRefusal(screenOn)?.let { report(it); return }
        var started = false
        try {
            talker.listen(client, event) {
                started = true
                banner.show(event.title, getString(R.string.banner_subtitle))
                report(reportJson(true))
            }
        } catch (e: Exception) {
            if (!started) report(reportJson(false, e.message ?: "son indisponible"))
        } finally {
            if (started) banner.hide()
        }
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
                is RemoteEvent.Workout -> handleWorkout(server, token, event)
            }
        } catch (e: Exception) {
            e.message ?: "erreur sur la télé"
        }
        runCatching { HubClient(server, token).call("POST", "/api/screen/events/${event.id}/report", reportJson(failure == null, failure)) }
        if (event is RemoteEvent.Launch || event is RemoteEvent.Power) sendState()
    }

    /** Alerte pluie du matin : bandeau parapluie pendant la durée demandée, puis compte rendu. */
    private fun handleRain(server: String, token: String, event: RainEvent) {
        val shown = if (event.discreet) banner.showDiscreet(event.title, event.subtitle, R.drawable.ic_umbrella, Film.durationMs(event.seconds))
        else banner.show(event.title, event.subtitle, voice = false, icon = R.drawable.ic_umbrella)
        if (shown && !event.discreet) Handler(mainLooper).postDelayed({ banner.hide() }, rainBannerMs(event))
        val report = if (shown) reportJson(true) else reportJson(false, "autorisation « afficher par-dessus » manquante")
        runCatching { HubClient(server, token).call("POST", "/api/screen/events/${event.id}/report", report) }
    }

    /** Un message écrit : bandeau qui s'en va seul au bout de sa durée, puis compte rendu (affiché, ou pourquoi pas). */
    private fun handleMessage(server: String, token: String, event: MessageEvent) {
        val shown = if (event.discreet) banner.showDiscreet(event.title, event.text, R.drawable.ic_message, Film.messageMs(event.seconds))
        else banner.showMessage(event.title, event.text, event.seconds, replier(server, token, event.replyId))
        val report = if (shown) reportJson(true) else reportJson(false, getString(R.string.message_not_allowed))
        runCatching { HubClient(server, token).call("POST", "/api/screen/events/${event.id}/report", report) }
    }

    /** Envoi d'une réponse rapide choisie sur le bandeau, hors du fil principal ; null : pas de réponses proposées. */
    private fun replier(server: String, token: String, replyId: String?): ((String) -> Unit)? = replyId?.let { id ->
        { key ->
            val body = Reponses.replyJson(key)
            if (body != null && !reports.isShutdown) reports.execute { runCatching { HubClient(server, token).call("POST", Reponses.path(id), body) } }
        }
    }

    /** Alerte du bus du matin : bandeau icône bus pendant `seconds` s, puis compte rendu. */
    private fun handleBus(server: String, token: String, event: BusEvent) {
        val shown = if (event.discreet) banner.showDiscreet(event.title, event.subtitle, R.drawable.ic_bus, Film.durationMs(event.seconds))
        else banner.show(event.title, event.subtitle, voice = false, icon = R.drawable.ic_bus)
        if (shown && !event.discreet) Handler(mainLooper).postDelayed({ banner.hide() }, event.seconds * 1_000L)
        val report = if (shown) reportJson(true) else reportJson(false, getString(R.string.bus_overlay_missing))
        runCatching { HubClient(server, token).call("POST", "/api/screen/events/${event.id}/report", report) }
    }

    /** Minuteur terminé pendant un film : bandeau discret, sans carillon ni « Arrêter » (la tablette sonne), compte rendu. */
    private fun handleQuietTimer(server: String, token: String, event: TimerEvent.Ring) {
        val shown = banner.showDiscreet(event.title, event.subtitle, R.drawable.ic_timer, Film.TIMER_MS)
        val report = if (shown) reportJson(true) else reportJson(false, "bandeau non autorisé sur la télé")
        runCatching { HubClient(server, token).call("POST", "/api/screen/events/${event.id}/report", report) }
    }

    /**
     * Une photo ou une vidéo partagée (fonction 11) : téléchargement, écran plein écran (MediaActivity), compte rendu
     * dès qu'elle est affichée ou lancée ; attend sa fermeture (Retour, fin, délai, ou la suivante) avant de passer.
     */
    private fun handleMedia(server: String, token: String, event: MediaEvent) {
        val client = HubClient(server, token)
        fun report(json: String) = runCatching { client.call("POST", "/api/screen/events/${event.id}/report", json) }
        if (!screenOn) {
            report(reportJson(false, getString(R.string.media_standby)))
            return
        }
        val file = File(cacheDir, "partage-${event.seq}.${mediaExtension(event.url)}")
        try {
            client.download(event.url, file)
            val session = MediaSession(event, file.absolutePath)
            MediaSessions.put(session)
            try {
                startActivity(Intent(this, MediaActivity::class.java).putExtra(MediaActivity.EXTRA_EVENT, event.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                val shown = session.started.await(MEDIA_START_S, TimeUnit.SECONDS)
                report(if (!shown) reportJson(false, getString(R.string.media_not_shown)) else session.error?.let { reportJson(false, it) } ?: reportJson(true))
                if (!session.closed.await(closeDelayMs(event.seconds) + 30_000, TimeUnit.MILLISECONDS)) MediaActivity.closeCurrent()
            } finally {
                MediaSessions.remove(event.id)
            }
        } catch (_: InterruptedException) {
            return
        } catch (e: Exception) {
            report(reportJson(false, getString(R.string.media_download_failed, e.message ?: "")))
        } finally {
            file.delete()
        }
    }

    /**
     * Séance de sport (fonction 12) : ouvrir la page de la séance, ou la fermer (tout est effacé en sortant) avec le
     * bandeau de fin ; null si c'est fait, sinon la raison.
     */
    private fun handleWorkout(server: String, token: String, event: RemoteEvent.Workout): String? {
        if (event.start) {
            val url = Sport.pageUrl(server, event.page, token) ?: return "adresse de page refusée"
            return SportActivity.open(this, url)
        }
        SportActivity.close()
        event.notice?.let { notice ->
            banner.show(notice.title, notice.subtitle, voice = false)
            Handler(mainLooper).postDelayed({ banner.hide() }, NOTICE_MS)
        }
        return null
    }

    /**
     * Mode cuisine d'une recette : ouvre la vue cuisine (elle lit ensuite elle-même ce qu'elle affiche) et rend compte
     * dès qu'elle est à l'écran. Ouverture depuis l'arrière-plan : permise par l'affichage par-dessus les autres applis.
     */
    private fun openCook(server: String, token: String, id: String) {
        val asked = SystemClock.elapsedRealtime()
        val failure = try {
            startActivity(Intent(this, CuisineActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            val deadline = asked + COOK_OPEN_MS
            while (!(CuisineActivity.visible && CuisineActivity.resumedAt >= asked) && SystemClock.elapsedRealtime() < deadline) Thread.sleep(100)
            if (CuisineActivity.visible) null else getString(R.string.cook_not_shown)
        } catch (e: InterruptedException) {
            return
        } catch (e: Exception) {
            e.message ?: getString(R.string.cook_not_shown)
        }
        runCatching { HubClient(server, token).call("POST", "/api/screen/events/$id/report", reportJson(failure == null, failure)) }
    }

    /**
     * Heure du coucher : ouvre l'écran de veille du coucher par-dessus le programme (en pause) et rend compte dès qu'il
     * est à l'écran, ou le ferme. Écran éteint : rien à ouvrir, la télé dort déjà.
     */
    private fun handleBedtime(server: String, token: String, event: BedtimeEvent) {
        val failure = try {
            if (!event.sleep) {
                CoucherActivity.close()
                null
            } else if (!getSystemService(PowerManager::class.java).isInteractive) {
                null
            } else {
                val asked = SystemClock.elapsedRealtime()
                CoucherActivity.open(this)
                val deadline = asked + Coucher.OPEN_MS
                while (!(CoucherActivity.visible && CoucherActivity.resumedAt >= asked) && SystemClock.elapsedRealtime() < deadline) Thread.sleep(100)
                if (CoucherActivity.visible) null else getString(R.string.bedtime_not_shown)
            }
        } catch (e: InterruptedException) {
            return
        } catch (e: Exception) {
            e.message ?: getString(R.string.bedtime_not_shown)
        }
        runCatching { HubClient(server, token).call("POST", "/api/screen/events/${event.id}/report", reportJson(failure == null, failure)) }
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
            val foreground = HomeHubAccessibility.foreground
            // Ce qui passe (fonction 18) : écran éteint, rien (une session en pause peut traîner en veille).
            val lecture = if (screenOn) HomeHubLecture.lecture(foreground) else null
            val json = stateJson(screenOn, foreground, telecommande.control(), addresses(), volume(), lecture)
            // Clé sans la position qui avance seule (Lecture.kt, cleLecture) : un saut ou une pause comptent.
            val key = stateJson(screenOn, foreground, telecommande.control(), addresses(), volume()) + cleLecture(lecture, SystemClock.elapsedRealtime())
            val now = System.currentTimeMillis()
            if (!force && key == lastState && now - lastStateAt < STATE_REFRESH_MS) return@execute
            runCatching { HubClient(server, token).call("POST", "/api/screen/state", json) }.onSuccess {
                lastState = key
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
        /** Attente de l'affichage d'une photo ou du début d'une vidéo, une fois téléchargée. */
        private const val MEDIA_START_S = 20L
        /** Attente de la vue cuisine à l'écran (sous les 8 s qu'attend HomeHub, COOK_OPEN_MS de screen-cook-api.ts). */
        private const val COOK_OPEN_MS = 6_000L

        /** Démarre le service si la télé est appairée. */
        fun startIfPaired(context: Context) {
            val prefs = Prefs(context)
            if (prefs.server != null && prefs.token != null) {
                context.startForegroundService(Intent(context, HubService::class.java))
            }
        }
    }
}
