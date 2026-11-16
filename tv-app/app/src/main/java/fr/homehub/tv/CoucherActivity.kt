// Écran de veille du coucher (fonction 16) : à l'heure du coucher, après la pause, HomeHub demande l'écran de veille ;
// l'appli ouvre par-dessus ce qui passe la même page que son écran de veille Android (HomeHubDream, fonction 8 : /ecran,
// heure, météo, agenda, menu), en plein écran. L'écran n'est pas gardé allumé : la mise en veille de la télé suit son
// cours. Retour le ferme (la télé revient au programme en pause) ; HomeHub le ferme aussi quand un parent repousse ou
// annule le coucher. Sa propre tâche, hors des récents : l'écran d'accueil de l'appli ne revient pas à sa fermeture.
package fr.homehub.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient

class CoucherActivity : Activity() {
    private var web: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        val prefs = Prefs(this)
        val url = Ecran.url(prefs.server, prefs.token) ?: return finish()
        val view = WebView(this).apply {
            setBackgroundColor(getColor(R.color.bg))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Les liens éventuels restent dans la WebView, jamais dans un navigateur ouvert par-dessus.
            webViewClient = WebViewClient()
            isFocusable = false
            systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            loadUrl(url)
        }
        web = view
        setContentView(view)
    }

    override fun onResume() {
        super.onResume()
        resumedAt = SystemClock.elapsedRealtime()
        visible = true
    }

    override fun onPause() {
        visible = false
        super.onPause()
    }

    /** Seuls Retour (qui ferme) et le volume passent : les autres touches ne relancent pas le programme par mégarde. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean =
        if (keyCode in PASSING_KEYS) super.onKeyDown(keyCode, event) else true

    override fun onDestroy() {
        if (current === this) current = null
        web?.destroy()
        web = null
        super.onDestroy()
    }

    companion object {
        /** Écran du coucher au premier plan (le service attend qu'il le soit pour rendre compte). */
        @Volatile var visible = false
        /** Dernier passage au premier plan (horloge depuis le démarrage). */
        @Volatile var resumedAt = 0L
        @Volatile private var current: CoucherActivity? = null
        private val PASSING_KEYS = setOf(KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_VOLUME_MUTE)

        fun open(context: Context) {
            context.startActivity(Intent(context, CoucherActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }

        /** Ferme l'écran s'il est ouvert (coucher repoussé ou annulé). */
        fun close() {
            current?.let { activity -> activity.runOnUiThread { activity.finish() } }
        }
    }
}
