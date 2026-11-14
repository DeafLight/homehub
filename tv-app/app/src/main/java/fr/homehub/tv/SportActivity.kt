// Séance de sport guidée sur la télé (fonction 12) : la page de HomeHub (web/tele-sport.html) en plein écran dans une
// WebView, écran gardé allumé, son permis sans geste (bips du décompte). Ouverte par le service quand le téléphone de
// la personne lance la séance ; fermée quand la séance se termine (ordre de HomeHub, ou la page qui le demande par le
// pont « HomeHubTV.close() »), ou par Retour à la télécommande. En sortant, tout est effacé : cache, historique,
// stockage de la page. La page ne montre que la séance en cours, rien de personnel (shared/screen-workout.ts).
package fr.homehub.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient

class SportActivity : Activity() {
    private var web: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val server = Prefs(this).server ?: return finish()
        val view = WebView(this).apply {
            setBackgroundColor(getColor(R.color.bg))
            settings.javaScriptEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            addJavascriptInterface(Bridge(), "HomeHubTV")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    !Sport.sameOrigin(server, request.url.toString())
            }
        }
        web = view
        setContentView(view)
        load(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        load(intent)
    }

    private fun load(intent: Intent) {
        intent.getStringExtra(EXTRA_URL)?.let { web?.loadUrl(it) } ?: finish()
    }

    override fun onDestroy() {
        if (current === this) current = null
        web?.apply {
            clearCache(true)
            clearHistory()
            clearFormData()
            removeJavascriptInterface("HomeHubTV")
            destroy()
        }
        web = null
        WebStorage.getInstance().deleteAllData()
        CookieManager.getInstance().removeAllCookies(null)
        super.onDestroy()
    }

    /** Pont offert à la page : elle demande à se fermer quand la séance n'existe plus. */
    private inner class Bridge {
        @JavascriptInterface
        fun close() {
            runOnUiThread { finish() }
        }
    }

    companion object {
        private const val EXTRA_URL = "url"
        @Volatile private var current: SportActivity? = null

        /** Ouvre la page `url` par-dessus ce qui passe ; null si c'est fait, sinon la raison. */
        fun open(context: Context, url: String): String? = try {
            context.startActivity(Intent(context, SportActivity::class.java).putExtra(EXTRA_URL, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            null
        } catch (e: Exception) {
            "page de la séance non ouverte : ${e.message}"
        }

        /** Ferme la page si elle est ouverte (fin de la séance). */
        fun close() {
            current?.let { activity -> activity.runOnUiThread { activity.finish() } }
        }
    }
}
