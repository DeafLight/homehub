// Alerte des minuteurs sur la télé (fonction 3) : bandeau en haut à droite (icône minuteur, « Cuisson », « C'est
// l'heure ! (10 min) », bouton « Arrêter ») et carillon court, son du programme baissé le temps du carillon. Le bandeau
// prend le focus de la télécommande, et lui seul : l'appli en cours continue (la vidéo ne s'arrête pas), mais flèches,
// OK et Retour vont au bandeau tant qu'il est là. OK : « Arrêter » arrête le minuteur partout (tablette, téléphones,
// autres télés) ; Retour : masque le bandeau sur cette télé seulement (le minuteur sonne toujours sur la tablette).
// Sans geste, le bandeau s'en va au bout de BANNER_MS ; arrêté ailleurs, il s'en va aussitôt (`timer-clear`).
// Minuteurs en cours (événement `timers`) : confiés à MinuteurDecompte, petit décompte en bas à droite que la
// télécommande ne voit pas (rien n'y est contrôlable). Chaque événement reçoit son compte rendu (bandeau affiché, ou
// autorisation « par-dessus » manquante).
package fr.homehub.tv

import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.util.concurrent.Executors

class MinuteurAlertes(private val context: Context, private val prefs: Prefs) {
    private val windows = context.getSystemService(WindowManager::class.java)
    private val audio = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    /** Comptes rendus et arrêts, hors du fil principal. */
    private val network = Executors.newSingleThreadExecutor()
    /** File des minuteurs qui sonnent (fil principal seulement). */
    private val queue = TimerQueue()
    /** Petit décompte des minuteurs en cours, en bas à droite (fil principal seulement). */
    private val decompte = MinuteurDecompte(context)
    private var shown: View? = null
    private var shownTimer: String? = null
    private val timeout = Runnable { shownTimer?.let { dismiss(it) } }

    /** Événements de minuteur reçus par le service (n'importe quel fil). */
    fun handle(events: List<TimerEvent>) {
        events.forEach { event ->
            val allowed = Settings.canDrawOverlays(context)
            main.post {
                when (event) {
                    is TimerEvent.Ring -> if (allowed && queue.ring(event)) {
                        playChime()
                        render()
                    }
                    is TimerEvent.Clear -> dismiss(event.timerId)
                }
            }
            report(event.id, if (event is TimerEvent.Ring && !allowed) "bandeau non autorisé sur la télé" else null)
        }
    }

    /** Listes des minuteurs en cours reçues par le service (n'importe quel fil) : la dernière fait foi. */
    fun running(events: List<RunningTimers>) {
        val latest = events.lastOrNull() ?: return
        val allowed = Settings.canDrawOverlays(context)
        if (allowed) main.post { decompte.update(latest) }
        events.forEach { report(it.id, if (allowed) null else "bandeau non autorisé sur la télé") }
    }

    fun stop() {
        main.post {
            queue.clear()
            render()
            decompte.hide()
        }
        network.shutdown()
    }

    private fun report(eventId: String, failure: String?) = call { client ->
        client.call("POST", "/api/screen/events/$eventId/report", reportJson(failure == null, failure))
    }

    private fun call(block: (HubClient) -> Unit) {
        val server = prefs.server ?: return
        val token = prefs.token ?: return
        if (network.isShutdown) return
        network.execute { runCatching { block(HubClient(server, token)) } }
    }

    /** « Arrêter » : arrêté partout par HomeHub ; le bandeau s'en va tout de suite, sans attendre la réponse. */
    private fun stopTimer(timerId: String) {
        call { it.call("POST", "/api/screen/timers/$timerId/stop", "{}") }
        dismiss(timerId)
    }

    /** Retire un minuteur de la file et affiche le suivant, s'il y en a un (fil principal). */
    private fun dismiss(timerId: String) {
        queue.remove(timerId)
        render()
    }

    /** Montre le minuteur en tête de file, ou retire le bandeau (fil principal). */
    private fun render() {
        val next = queue.shown
        if (next?.timerId == shownTimer && shown != null) return
        main.removeCallbacks(timeout)
        shown?.let { runCatching { windows.removeView(it) } }
        shown = null
        shownTimer = null
        if (next == null) return
        val view = build(next)
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // Focalisable (sans FLAG_NOT_FOCUSABLE) : la télécommande vient au bandeau ; le reste de l'écran ne change pas.
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = dp(32)
            y = dp(28)
        }
        runCatching { windows.addView(view, params) }.onSuccess {
            shown = view
            shownTimer = next.timerId
            view.alpha = 0f
            view.animate().alpha(1f).setDuration(250).start()
            main.postDelayed(timeout, BANNER_MS)
        }
    }

    /** Carillon court, son du programme baissé le temps de le jouer (comme la voix en direct). */
    private fun playChime() {
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            .setWillPauseWhenDucked(false)
            .setOnAudioFocusChangeListener { }
            .build()
        runCatching {
            val samples = chime()
            val track = AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(CHIME_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(samples.size * 2)
                .build()
            track.write(samples, 0, samples.size)
            audio.requestAudioFocus(focus)
            track.play()
            main.postDelayed({
                runCatching { track.release() }
                audio.abandonAudioFocusRequest(focus)
            }, samples.size * 1000L / CHIME_RATE + 300)
        }
    }

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

    private fun color(id: Int) = context.getColor(id)

    private fun rounded(colorId: Int, radius: Int) = GradientDrawable().apply {
        cornerRadius = dp(radius).toFloat()
        setColor(color(colorId))
    }

    private fun build(timer: TimerEvent.Ring): View {
        // Retour masque le bandeau ; les autres touches restent au bandeau (rien ne part à l'appli dessous par erreur).
        val root = object : FrameLayout(context) {
            override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                    if (event.action == KeyEvent.ACTION_UP) dismiss(timer.timerId)
                    return true
                }
                return super.dispatchKeyEvent(event)
            }
        }
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = rounded(R.color.surface_banner, 16)
            elevation = dp(8).toFloat()
        }
        val icon = ImageView(context).apply {
            setImageResource(R.drawable.ic_timer)
            setPadding(dp(9), dp(9), dp(9), dp(9))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(color(R.color.sun))
            }
        }
        row.addView(icon, LinearLayout.LayoutParams(dp(40), dp(40)))

        val texts = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(TextView(context).apply {
            text = timer.title
            setTextColor(color(R.color.fg))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = Typeface.DEFAULT_BOLD
        })
        texts.addView(TextView(context).apply {
            text = timer.subtitle
            setTextColor(color(R.color.fg_muted))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        })
        texts.addView(TextView(context).apply {
            text = context.getString(R.string.timer_hint)
            setTextColor(color(R.color.fg_muted))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        })
        row.addView(texts, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(12) })

        val stop = Button(context).apply {
            text = context.getString(R.string.timer_stop)
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(color(R.color.bg))
            minHeight = 0
            minimumHeight = 0
            setPadding(dp(20), dp(8), dp(20), dp(8))
            // Contour clair quand il a le focus (c'est toujours le cas : seul élément focalisable du bandeau).
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), GradientDrawable().apply {
                    cornerRadius = dp(999).toFloat()
                    setColor(color(R.color.sun))
                    setStroke(dp(3), color(R.color.fg))
                })
                addState(intArrayOf(), rounded(R.color.sun, 999))
            }
            isFocusable = true
            setOnClickListener { stopTimer(timer.timerId) }
        }
        row.addView(stop, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(18) })
        root.addView(row)
        stop.post { stop.requestFocus() }
        return root
    }

    companion object {
        /** Sans geste, le bandeau s'en va au bout de 10 min (le minuteur sonne toujours sur la tablette). */
        const val BANNER_MS = 10 * 60_000L
    }
}
