// Écran d'accueil de HomeHub TV, en trois états. Sans adresse de HomeHub : la commande adb qui la donne
// (`--es server …`, reçue ici). Pas encore appairée : un code en grand, à taper sur la tablette (Téléphones → Télés),
// renouvelé quand il expire ; la télé attend la réponse par interrogation longue. Appairée : son nom, l'état de la
// connexion, l'état de la télécommande, l'autorisation du bandeau (sinon la commande adb), la version, et « Essayer le
// bandeau ».
package fr.homehub.tv

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var banner: OverlayBanner
    private val main = Handler(Looper.getMainLooper())
    private lateinit var root: LinearLayout
    @Volatile private var pairingThread: Thread? = null

    private val refresh = object : Runnable {
        override fun run() {
            render()
            main.postDelayed(this, 2_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        banner = OverlayBanner(this)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(getColor(R.color.bg))
            setPadding(dp(64), dp(48), dp(64), dp(48))
        }
        setContentView(root)
        takeServer(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeServer(intent)
    }

    override fun onResume() {
        super.onResume()
        HubService.startIfPaired(this)
        main.post(refresh)
    }

    override fun onPause() {
        main.removeCallbacks(refresh)
        super.onPause()
    }

    override fun onDestroy() {
        pairingThread?.interrupt()
        super.onDestroy()
    }

    /** Adresse donnée par adb (`--es server …`) ; une autre adresse que la précédente oublie l'appairage. */
    private fun takeServer(intent: Intent?) {
        val raw = intent?.getStringExtra("server") ?: return
        val server = normalizeServer(raw) ?: return
        if (server != prefs.server) {
            stopService(Intent(this, HubService::class.java))
            prefs.forgetPairing()
            prefs.server = server
            prefs.status = null
        }
    }

    private var pairingCode: String? = null
    private var pairingError: String? = null

    /** État affiché la dernière fois : on ne refait l'écran que s'il change (le focus de la télécommande reste en place). */
    private var shownKey: String? = null

    private fun render() {
        val server = prefs.server
        val key = listOf(server, prefs.token != null, prefs.screenName, pairingCode, pairingError, prefs.status, prefs.remoteStatus, banner.allowed()).joinToString("|")
        if (key == shownKey) {
            if (server != null && prefs.token == null) startPairing(server)
            return
        }
        shownKey = key
        root.removeAllViews()
        when {
            server == null -> {
                title(getString(R.string.app_name))
                text(getString(R.string.setup_needed))
                mono("adb shell am start -n $packageName/.MainActivity --es server http://<adresse-de-homehub>")
            }
            prefs.token == null -> {
                startPairing(server)
                title(getString(R.string.pairing_title))
                val code = pairingCode
                if (code != null) {
                    big(code.chunked(3).joinToString(" "))
                    text(getString(R.string.pairing_hint))
                } else {
                    text(getString(R.string.pairing_waiting, server))
                }
                pairingError?.let { text(it, muted = true) }
                prefs.status?.takeIf { it == getString(R.string.status_removed) }?.let { text(it, muted = true) }
            }
            else -> {
                title(prefs.screenName ?: getString(R.string.app_name))
                text(prefs.status ?: getString(R.string.status_starting))
                prefs.remoteStatus?.let { text(it, muted = true) }
                text(server, muted = true)
                if (banner.allowed()) {
                    button(getString(R.string.try_banner)) { tryBanner() }
                } else {
                    text(getString(R.string.overlay_missing), muted = true)
                    mono("adb shell appops set $packageName SYSTEM_ALERT_WINDOW allow")
                }
            }
        }
        text(getString(R.string.version, versionName()), muted = true, small = true)
    }

    /** Demande un code, l'affiche, attend que la tablette le confirme ; un code expiré en fait demander un autre. */
    private fun startPairing(server: String) {
        if (pairingThread?.isAlive == true) return
        pairingThread = Thread({
            try {
                while (!Thread.currentThread().isInterrupted && prefs.token == null) {
                    val client = HubClient(server)
                    val body = JSONObject().put("system", "Android ${Build.VERSION.RELEASE}").put("app", versionName()).toString()
                    val start = try {
                        parsePairingStart(client.call("POST", "/api/screen/pairing", body))
                    } catch (e: HubError) {
                        show(code = null, error = e.message)
                        Thread.sleep(if (e.status == 426) 60_000 else 10_000)
                        continue
                    } catch (e: Exception) {
                        show(code = null, error = getString(R.string.status_unreachable, server))
                        Thread.sleep(10_000)
                        continue
                    }
                    show(code = start.code, error = null)
                    while (!Thread.currentThread().isInterrupted) {
                        val state = try {
                            parsePairingState(client.call("GET", "/api/screen/pairing/${start.id}", readTimeoutMs = 40_000))
                        } catch (e: HubError) {
                            if (e.status == 410) break else throw e
                        } catch (e: java.io.IOException) {
                            Thread.sleep(3_000)
                            continue
                        }
                        if (state is PairingState.Paired) {
                            prefs.token = state.token
                            prefs.screenName = state.name
                            prefs.status = null
                            main.post {
                                HubService.startIfPaired(this)
                                render()
                            }
                            return@Thread
                        }
                    }
                }
            } catch (_: InterruptedException) {
            } catch (e: Exception) {
                show(code = null, error = e.message)
            }
        }, "homehub-pairing").also { it.start() }
    }

    private fun show(code: String?, error: String?) = main.post {
        pairingCode = code
        pairingError = error
        render()
    }

    private fun tryBanner() {
        banner.show(getString(R.string.try_banner_title), getString(R.string.banner_subtitle))
        main.postDelayed({ banner.hide() }, 4_000)
    }

    private fun versionName(): String = packageManager.getPackageInfo(packageName, 0).versionName ?: "?"

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    private fun add(view: View) {
        root.addView(view, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(12)
        })
    }

    private fun label(value: String, sizeSp: Float, colorId: Int) = TextView(this).apply {
        text = value
        gravity = Gravity.CENTER
        setTextColor(getColor(colorId))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
    }

    private fun title(value: String) = add(label(value, 34f, R.color.fg).apply { typeface = Typeface.DEFAULT_BOLD })

    private fun big(value: String) = add(label(value, 96f, R.color.sun).apply {
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        letterSpacing = 0.1f
    })

    private fun text(value: String, muted: Boolean = false, small: Boolean = false) =
        add(label(value, if (small) 14f else 20f, if (muted) R.color.fg_muted else R.color.fg))

    private fun mono(value: String) = add(label(value, 16f, R.color.fg).apply {
        typeface = Typeface.MONOSPACE
        setPadding(dp(16), dp(10), dp(16), dp(10))
        setBackgroundColor(getColor(R.color.surface))
    })

    private fun button(value: String, onClick: () -> Unit) = add(Button(this).apply {
        text = value
        setOnClickListener { onClick() }
    })
}
