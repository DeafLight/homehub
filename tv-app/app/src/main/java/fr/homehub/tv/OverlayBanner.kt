// Bandeau par-dessus les autres applis, en haut à droite de l'écran, pendant un message vocal : icône micro, « Message
// d'Alex », « Le son du programme est baissé », barres de niveau qui bougent. Pour un avis (« À table ! » de la
// télécommande) : icône cloche, sans barres. Pour un message écrit (showMessage) : en haut au centre, icône bulle, le
// titre en petit et le texte en gros, qui s'en va seul au bout de sa durée. Couleurs du thème sombre de HomeHub. Il ne
// prend ni le focus ni la télécommande. Il faut l'autorisation « afficher par-dessus » (adb : appops SYSTEM_ALERT_WINDOW).
package fr.homehub.tv

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

class OverlayBanner(private val context: Context) {
    private val windows = context.getSystemService(WindowManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private var shown: View? = null
    private val animators = mutableListOf<ValueAnimator>()
    /** Numéro du dernier bandeau affiché : la fin d'un message écrit n'enlève pas un bandeau venu après lui. */
    private var generation = 0

    fun allowed(): Boolean = Settings.canDrawOverlays(context)

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

    private fun color(id: Int) = context.getColor(id)

    /** Affiche le bandeau (remplace le précédent) ; false si l'autorisation manque. */
    fun show(title: String, subtitle: String, voice: Boolean = true): Boolean {
        if (!allowed()) return false
        main.post {
            hideNow()
            val view = build(title, subtitle, voice)
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                x = dp(32)
                y = dp(28)
            }
            runCatching { windows.addView(view, params) }.onSuccess {
                shown = view
                view.alpha = 0f
                view.animate().alpha(1f).setDuration(250).start()
            }
        }
        return true
    }

    /**
     * Message écrit : en haut au centre, texte en gros, retiré au bout de `seconds` secondes (sauf si un autre bandeau
     * l'a remplacé entre-temps) ; false si l'autorisation manque.
     */
    fun showMessage(title: String, text: String, seconds: Int): Boolean {
        if (!allowed()) return false
        main.post {
            hideNow()
            val mine = generation
            val view = buildMessage(title, text)
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                y = dp(36)
            }
            runCatching { windows.addView(view, params) }.onSuccess {
                shown = view
                view.alpha = 0f
                view.animate().alpha(1f).setDuration(250).start()
                main.postDelayed({ if (generation == mine) hideNow() }, seconds * 1000L)
            }
        }
        return true
    }

    fun hide() = main.post { hideNow() }

    private fun hideNow() {
        generation++
        animators.forEach { it.cancel() }
        animators.clear()
        shown?.let { runCatching { windows.removeView(it) } }
        shown = null
    }

    private fun build(title: String, subtitle: String, voice: Boolean): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(12), dp(20), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(color(R.color.surface_banner))
            }
            elevation = dp(8).toFloat()
        }
        val icon = ImageView(context).apply {
            setImageResource(if (voice) R.drawable.ic_mic else R.drawable.ic_bell)
            setPadding(dp(9), dp(9), dp(9), dp(9))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(color(R.color.rain))
            }
        }
        row.addView(icon, LinearLayout.LayoutParams(dp(40), dp(40)))

        val texts = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(TextView(context).apply {
            text = title
            setTextColor(color(R.color.fg))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = Typeface.DEFAULT_BOLD
        })
        texts.addView(TextView(context).apply {
            text = subtitle
            setTextColor(color(R.color.fg_muted))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        })
        row.addView(texts, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(12) })

        if (!voice) return row
        // Barres de niveau : animation régulière (le vrai niveau du son demanderait le micro), décalée d'une barre à l'autre.
        val bars = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        repeat(5) { i ->
            val bar = View(context).apply {
                background = GradientDrawable().apply {
                    cornerRadius = dp(2).toFloat()
                    setColor(color(R.color.rain))
                }
            }
            bars.addView(bar, LinearLayout.LayoutParams(dp(4), dp(24)).apply { marginStart = dp(3) })
            animators += ValueAnimator.ofFloat(0.3f, 1f).apply {
                duration = 380L + i * 70L
                repeatMode = ValueAnimator.REVERSE
                repeatCount = ValueAnimator.INFINITE
                startDelay = i * 90L
                addUpdateListener { bar.scaleY = it.animatedValue as Float }
                start()
            }
        }
        row.addView(bars, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(28)).apply { marginStart = dp(10) })
        return row
    }

    private fun buildMessage(title: String, text: String): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
            setPadding(dp(18), dp(16), dp(28), dp(18))
            background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat()
                setColor(color(R.color.surface_banner))
            }
            elevation = dp(8).toFloat()
        }
        val icon = ImageView(context).apply {
            setImageResource(R.drawable.ic_message)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(color(R.color.rain))
            }
        }
        row.addView(icon, LinearLayout.LayoutParams(dp(44), dp(44)))
        val texts = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(TextView(context).apply {
            this.text = title
            setTextColor(color(R.color.fg_muted))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = Typeface.DEFAULT_BOLD
        })
        texts.addView(TextView(context).apply {
            this.text = text
            setTextColor(color(R.color.fg))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
            typeface = Typeface.DEFAULT_BOLD
            // 140 caractères au plus (shared/tv.ts) : sur deux ou trois lignes, jamais plus large que les deux tiers de l'écran.
            maxWidth = context.resources.displayMetrics.widthPixels * 2 / 3
        })
        row.addView(texts, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(16) })
        return row
    }
}
