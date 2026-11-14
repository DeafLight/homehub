// Écran de veille HomeHub (fonction 8) : quand la télé se met en veille d'écran, Android lance ce DreamService, qui
// affiche dans une WebView la page /ecran de HomeHub (heure, météo, agenda de la famille, menu du soir) avec le jeton
// de la télé. Choisi par adb (installer.ps1 : settings put secure screensaver_components fr.homehub.tv/.HomeHubDream).
// Non interactif : la première touche de la télécommande le ferme. Pas encore appairée : un mot qui le dit.
package fr.homehub.tv

import android.annotation.SuppressLint
import android.graphics.Color
import android.service.dreams.DreamService
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView

class HomeHubDream : DreamService() {
    private var web: WebView? = null

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true
        val prefs = Prefs(this)
        val url = Ecran.url(prefs.server, prefs.token)
        setContentView(if (url == null) notPaired() else page(url))
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun page(url: String): View {
        val view = WebView(this)
        view.setBackgroundColor(getColor(R.color.bg))
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        // Les liens éventuels restent dans la WebView, jamais dans un navigateur ouvert par-dessus.
        view.webViewClient = WebViewClient()
        view.isFocusable = false
        view.loadUrl(url)
        web = view
        return view
    }

    private fun notPaired(): View = TextView(this).apply {
        text = getString(R.string.dream_not_paired)
        gravity = Gravity.CENTER
        setTextColor(getColor(R.color.fg_muted))
        setBackgroundColor(Color.BLACK)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
    }

    override fun onDetachedFromWindow() {
        web?.destroy()
        web = null
        super.onDetachedFromWindow()
    }
}
