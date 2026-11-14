// Vue cuisine d'une recette sur la télé (fonction 13), en vues Android natives (pas de WebView : docs/appli-tele.md).
// Ouverte par le service sur l'événement « cook » (« Sur la télé » depuis la fiche recette), dans sa propre tâche :
// Retour la ferme et rend la télé à ce qui passait. Elle lit ce qu'elle affiche à HomeHub (GET /api/screen/cook,
// attente courte réveillée par un changement d'étape) : l'étape en cours en grand, son mode Cookeo, les boutons de ses
// durées (« Lancer 25 min », ou le décompte du minuteur déjà lancé), les minuteurs de la maison qui tournent (un qui
// sonne s'arrête par OK), et le début de l'étape suivante. Flèches gauche/droite : étape précédente ou suivante ;
// haut/bas : d'un bouton à l'autre ; OK : le bouton choisi. L'écran reste allumé pendant la recette ; une télé en
// veille se rallume à l'ouverture. Plus de mode cuisine (arrêté depuis le téléphone ou la tablette) : la vue se ferme.
package fr.homehub.tv

import android.app.Activity
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.concurrent.Executors

class CuisineActivity : Activity() {
    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())
    private val actions = Executors.newSingleThreadExecutor()
    @Volatile private var running = false
    private var poller: Thread? = null

    private lateinit var root: LinearLayout
    private var view: CookView? = null
    /** Instant (horloge de la télé depuis son démarrage) de la dernière réponse : base du décompte. */
    private var receivedAt = 0L
    private var shownLayout: String? = null
    /** Textes à décompter chaque seconde, par minuteur. */
    private val countdowns = mutableMapOf<String, MutableList<TextView>>()
    private var error: TextView? = null

    private val tick = object : Runnable {
        override fun run() {
            updateCountdowns()
            main.postDelayed(this, 1_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setTurnScreenOn(true)
        setShowWhenLocked(true)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(getColor(R.color.bg))
            setPadding(dp(48), dp(32), dp(48), dp(28))
        }
        setContentView(root)
        message(getString(R.string.cook_loading))
    }

    override fun onResume() {
        super.onResume()
        resumedAt = SystemClock.elapsedRealtime()
        visible = true
        running = true
        if (poller?.isAlive != true) poller = Thread(::poll, "homehub-cuisine").also { it.start() }
        main.post(tick)
    }

    override fun onPause() {
        visible = false
        main.removeCallbacks(tick)
        super.onPause()
    }

    override fun onDestroy() {
        running = false
        poller?.interrupt()
        actions.shutdownNow()
        super.onDestroy()
    }

    /** Lit la vue cuisine en boucle ; plus de mode cuisine, ou télé retirée : la vue se ferme. */
    private fun poll() {
        var backoffMs = 2_000L
        while (running) {
            val server = prefs.server
            val token = prefs.token
            if (server == null || token == null) return close(remote = false)
            try {
                val after = view?.rev?.let { "?after=$it" } ?: ""
                val cook = parseCookView(HubClient(server, token).call("GET", "/api/screen/cook$after", readTimeoutMs = 20_000))
                backoffMs = 2_000L
                if (cook == null) return close(remote = false)
                main.post { show(cook, null) }
            } catch (e: HubError) {
                if (e.status == 401) return close(remote = false)
                main.post { showError(e.message) }
                if (!pause(backoffMs)) return
                backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
            } catch (e: Exception) {
                if (!running) return
                main.post { showError(getString(R.string.cook_unreachable)) }
                if (!pause(backoffMs)) return
                backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
            }
        }
    }

    private fun pause(ms: Long): Boolean = try {
        Thread.sleep(ms)
        true
    } catch (_: InterruptedException) {
        false
    }

    /** Une action de la télécommande (étape, minuteur) ; la vue revient avec la réponse. */
    private fun act(method: String, path: String, body: String? = null) {
        val server = prefs.server ?: return
        val token = prefs.token ?: return
        if (actions.isShutdown) return
        actions.execute {
            try {
                parseCookView(HubClient(server, token).call(method, path, body))?.let { cook -> main.post { show(cook, null) } }
            } catch (e: HubError) {
                main.post { showError(e.message) }
            } catch (e: Exception) {
                main.post { showError(getString(R.string.cook_unreachable)) }
            }
        }
    }

    /** Fin : Retour (le mode cuisine s'arrête aussi sur HomeHub), ou mode cuisine arrêté ailleurs. */
    private fun close(remote: Boolean) {
        running = false
        if (remote) {
            val server = prefs.server
            val token = prefs.token
            if (server != null && token != null && !actions.isShutdown) actions.execute { runCatching { HubClient(server, token).call("DELETE", "/api/screen/cook") } }
        }
        main.post { if (!isFinishing) finish() }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val key = cookKey(event.keyCode)
        if (key == CookKey.OTHER) return super.dispatchKeyEvent(event)
        if (event.action != KeyEvent.ACTION_DOWN) return true
        val cook = view
        when (key) {
            CookKey.PREVIOUS -> if (cook != null && cook.index > 0) act("POST", "/api/screen/cook/step", stepJson(cook.index - 1))
            CookKey.NEXT -> if (cook != null && cook.index < cook.total - 1) act("POST", "/api/screen/cook/step", stepJson(cook.index + 1))
            CookKey.CLOSE -> close(remote = true)
            CookKey.OTHER -> Unit
        }
        return true
    }

    // --- Affichage ---

    private fun show(cook: CookView, problem: String?) {
        if (!running) return
        view = cook
        receivedAt = SystemClock.elapsedRealtime()
        if (cook.layoutKey != shownLayout) {
            shownLayout = cook.layoutKey
            build(cook)
        }
        error?.let { it.text = problem ?: ""; it.visibility = if (problem == null) View.GONE else View.VISIBLE }
        updateCountdowns()
    }

    private fun showError(text: String?) {
        error?.apply {
            this.text = text ?: getString(R.string.cook_unreachable)
            visibility = View.VISIBLE
        } ?: message(text ?: getString(R.string.cook_unreachable))
    }

    private fun message(text: String) {
        root.removeAllViews()
        root.gravity = Gravity.CENTER
        root.addView(label(text, 28f, muted = true).apply { gravity = Gravity.CENTER })
    }

    /** Refait l'écran (autre étape, minuteur lancé ou arrêté) ; le focus va au premier bouton de l'étape. */
    private fun build(cook: CookView) {
        root.removeAllViews()
        root.gravity = Gravity.NO_GRAVITY
        countdowns.clear()
        val step = cook.step

        // En-tête : recette, partie de l'étape, numéro.
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val where = listOfNotNull(cook.title, step?.section).joinToString(" · ")
        header.addView(label(where, 24f, muted = true).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(label(if (cook.total > 0) getString(R.string.cook_step_of, cook.index + 1, cook.total) else "", 26f, bold = true))
        root.addView(header)

        // Corps : l'étape à gauche, les minuteurs de la maison à droite.
        val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        root.addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(20); bottomMargin = dp(16) })

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(getColor(R.color.surface), 28f)
            setPadding(dp(36), dp(28), dp(36), dp(28))
        }
        body.addView(card, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        if (step == null) {
            card.addView(label(getString(R.string.cook_no_steps), 34f, muted = true))
        } else {
            card.addView(label(step.text, stepTextSize(step.text.length), bold = true).apply { setLineSpacing(0f, 1.2f) })
            step.mode?.let { mode ->
                card.addView(label(getString(R.string.cook_mode, mode), 24f, bold = true).apply {
                    setTextColor(getColor(R.color.sun))
                    background = rounded(getColor(R.color.sun_bg), 999f)
                    setPadding(dp(20), dp(8), dp(20), dp(8))
                }, wrap().apply { topMargin = dp(20) })
            }
            val tools = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            step.durations.forEach { d -> tools.addView(durationButton(d), wrap().apply { topMargin = dp(14) }) }
            card.addView(tools, wrap().apply { topMargin = dp(10) })
        }

        if (cook.timers.isNotEmpty()) {
            val side = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = rounded(getColor(R.color.surface), 24f)
                setPadding(dp(22), dp(20), dp(22), dp(20))
            }
            side.addView(label(getString(R.string.cook_timers), 20f, muted = true))
            cook.timers.forEach { side.addView(timerRow(it), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) }) }
            body.addView(side, LinearLayout.LayoutParams(dp(300), LinearLayout.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(20) })
        }

        // Pied : la suite, l'aide des touches, l'erreur éventuelle.
        val footer = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        footer.addView(label(cook.next?.let { getString(R.string.cook_next, it) } ?: getString(R.string.cook_last), 22f, muted = true).apply { maxLines = 2 }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        footer.addView(label(getString(R.string.cook_keys), 20f, muted = true).apply { gravity = Gravity.END })
        root.addView(footer)
        error = label("", 20f).apply { setTextColor(getColor(R.color.sun)); visibility = View.GONE }
        root.addView(error)

        // Focus de la télécommande : le premier bouton (durée de l'étape, ou minuteur qui sonne).
        root.post { firstFocusable(root)?.requestFocus() }
    }

    /** « Lancer 25 min », ou le décompte du minuteur déjà lancé pour cette durée (OK ne fait rien de plus). */
    private fun durationButton(d: CookDuration): Button = button(if (d.timerId == null) getString(R.string.cook_start, d.text) else "", primary = d.timerId == null) {
        if (d.timerId == null) act("POST", "/api/screen/cook/timers", timerJson(d.seconds))
    }.also { b -> d.timerId?.let { id -> countdowns.getOrPut(id) { mutableListOf() }.add(b) } }

    /** Un minuteur de la maison : nom, décompte ; qui sonne, un bouton « Arrêter » (OK). */
    private fun timerRow(t: CookTimer): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        row.addView(label(t.label, 20f, muted = t.step == null).apply { maxLines = 2 })
        if (t.ended) {
            row.addView(button(getString(R.string.cook_stop_ringing), primary = false, ringing = true) { act("DELETE", "/api/screen/cook/timers/${t.id}") }, wrap().apply { topMargin = dp(6) })
        } else {
            row.addView(label("", 34f, bold = true).apply { setTextColor(getColor(R.color.rain)); countdowns.getOrPut(t.id) { mutableListOf() }.add(this) })
        }
        return row
    }

    private fun updateCountdowns() {
        val cook = view ?: return
        val elapsed = SystemClock.elapsedRealtime() - receivedAt
        for (t in cook.timers) {
            val left = formatRemaining(remainingAfter(t, elapsed))
            countdowns[t.id]?.forEach { v -> v.text = if (v is Button) getString(R.string.cook_running, left) else left }
        }
    }

    private fun firstFocusable(v: View): View? {
        if (v is Button && v.isFocusable) return v
        if (v is LinearLayout) for (i in 0 until v.childCount) firstFocusable(v.getChildAt(i))?.let { return it }
        return null
    }

    private fun label(text: String, sp: Float, muted: Boolean = false, bold: Boolean = false) = TextView(this).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(getColor(if (muted) R.color.fg_muted else R.color.fg))
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    /** Bouton de la télécommande : bordure claire quand il a le focus. */
    private fun button(text: String, primary: Boolean, ringing: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
        typeface = Typeface.DEFAULT_BOLD
        val fill = getColor(when { ringing -> R.color.sun; primary -> R.color.rain; else -> R.color.surface_2 })
        setTextColor(getColor(if (primary || ringing) R.color.bg else R.color.fg))
        background = rounded(fill, 18f)
        setPadding(dp(28), dp(14), dp(28), dp(14))
        isFocusable = true
        setOnFocusChangeListener { v, focused -> v.background = rounded(fill, 18f, stroke = if (focused) getColor(R.color.fg) else null) }
        setOnClickListener { onClick() }
    }

    private fun rounded(color: Int, radiusDp: Float, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radiusDp * resources.displayMetrics.density
        stroke?.let { setStroke(dp(4), it) }
    }

    private fun wrap() = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        /** Vue cuisine à l'écran (le service attend qu'elle le soit pour rendre compte de l'ouverture). */
        @Volatile var visible = false
        /** Dernier passage au premier plan (horloge depuis le démarrage). */
        @Volatile var resumedAt = 0L
    }
}
