// Minuteurs en cours sur la télé (fonction 3) : en petit, en bas à droite, par-dessus tout, le minuteur le plus proche
// de la fin (icône, nom, temps restant) et « +1 » s'il y en a d'autres. Fenêtre non focalisable et non touchable : la
// télécommande ne la voit pas, rien ne change pour l'appli en cours. Décompte chaque seconde à partir de la liste
// reçue (événement `timers`, Countdown dans Minuteur.kt) ; s'en va quand plus rien ne tourne. Fil principal seulement.
package fr.homehub.tv

import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

class MinuteurDecompte(private val context: Context) {
    private val windows = context.getSystemService(WindowManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private var countdown: Countdown? = null
    private var view: View? = null
    private var label: TextView? = null
    private var remaining: TextView? = null
    private var others: TextView? = null
    private val tick = object : Runnable {
        override fun run() {
            if (render()) main.postDelayed(this, 1000L - SystemClock.elapsedRealtime() % 1000L + 5)
        }
    }

    /** Nouvelle liste des minuteurs en cours (vide : plus rien à montrer). */
    fun update(event: RunningTimers) {
        countdown = Countdown(event.timers, event.serverNow, SystemClock.elapsedRealtime())
        main.removeCallbacks(tick)
        tick.run()
    }

    fun hide() {
        countdown = null
        main.removeCallbacks(tick)
        render()
    }

    /** Met l'affichage à jour ; false quand il n'y a plus rien à décompter. */
    private fun render(): Boolean {
        val shown = countdown?.at(SystemClock.elapsedRealtime())
        if (shown == null) {
            view?.let { runCatching { windows.removeView(it) } }
            view = null
            return false
        }
        if (view == null && !show()) return false
        label?.text = shown.label
        remaining?.text = shown.remaining
        others?.text = if (shown.others > 0) "+${shown.others}" else ""
        others?.visibility = if (shown.others > 0) View.VISIBLE else View.GONE
        return true
    }

    private fun show(): Boolean {
        val root = build()
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.END
            x = dp(28)
            y = dp(24)
        }
        return runCatching { windows.addView(root, params) }.onSuccess { view = root }.isSuccess
    }

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

    private fun color(id: Int) = context.getColor(id)

    private fun build(): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(6), dp(14), dp(6))
            background = GradientDrawable().apply {
                cornerRadius = dp(999).toFloat()
                setColor(color(R.color.surface_banner))
            }
            elevation = dp(6).toFloat()
        }
        row.addView(ImageView(context).apply {
            setImageResource(R.drawable.ic_timer)
            setPadding(dp(5), dp(5), dp(5), dp(5))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(color(R.color.sun))
            }
        }, LinearLayout.LayoutParams(dp(26), dp(26)))
        label = TextView(context).apply {
            setTextColor(color(R.color.fg_muted))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            maxLines = 1
            maxWidth = dp(160)
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        row.addView(label, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(8) })
        remaining = TextView(context).apply {
            setTextColor(color(R.color.fg))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = Typeface.DEFAULT_BOLD
            // Chiffres de même largeur : le compte à rebours ne bouge pas d'une seconde à l'autre.
            fontFeatureSettings = "tnum"
        }
        row.addView(remaining, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(8) })
        others = TextView(context).apply {
            setTextColor(color(R.color.sun))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
        }
        row.addView(others, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(8) })
        return row
    }
}
