// Bandeau par-dessus les autres applis, en haut à droite de l'écran, pendant qu'un parent parle en direct : icône micro,
// « Alex vous parle », « Le son du programme est baissé », barres de niveau qui bougent. Pour un avis (« À table ! » de la
// télécommande) : icône cloche, sans barres ; pour l'alerte du bus : icône bus, pour l'alerte pluie : parapluie (`icon`). Pour un message écrit (showMessage) : en haut au centre, icône bulle, le
// titre en petit et le texte en gros, qui s'en va seul au bout de sa durée. Couleurs du thème sombre de HomeHub.
// Sans réponses, il ne prend ni le focus ni la télécommande. Réponses rapides (fonction 10, `onReply`) : sous un message
// écrit, trois boutons « OK », « J'arrive », « 5 minutes » ; le bandeau prend alors le focus de la
// télécommande, comme celui du minuteur (fenêtre focalisable : l'appli en cours continue, ◀ ▶ et OK vont au bandeau,
// Retour le masque sans répondre). Une réponse choisie part à HomeHub et le bandeau dit « Réponse envoyée » avant de
// s'en aller ; chaque touche le garde au moins Reponses.IDLE_MS. Mode film (showDiscreet, fonction 15) : petit bandeau
// en bas à gauche, à demi transparent, texte réduit, sans réponses, qui s'en va seul (Film.kt). Il faut l'autorisation
// « afficher par-dessus » (adb : appops SYSTEM_ALERT_WINDOW).
package fr.homehub.tv

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
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

class OverlayBanner(private val context: Context) {
    private val windows = context.getSystemService(WindowManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private var shown: View? = null
    private val animators = mutableListOf<ValueAnimator>()
    /** Numéro du dernier bandeau affiché : la fin d'un message écrit n'enlève pas un bandeau venu après lui. */
    private var generation = 0
    /** Le bandeau affiché propose des réponses, pas encore choisies (fil principal). */
    private var offering = false
    /** Heure (SystemClock.uptimeMillis) où le bandeau s'en va seul ; 0 : pas de fin prévue (voix en direct en cours). */
    private var expireAt = 0L
    private val expire = Runnable { hideNow() }

    fun allowed(): Boolean = Settings.canDrawOverlays(context)

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

    private fun color(id: Int) = context.getColor(id)

    /**
     * Affiche le bandeau (remplace le précédent) ; false si l'autorisation manque. `onReply` : réponses rapides
     * proposées (le bandeau prend la télécommande), appelé avec la clé choisie (Reponses.CHOIX).
     */
    fun show(title: String, subtitle: String, voice: Boolean = true, icon: Int? = null, onReply: ((String) -> Unit)? = null): Boolean {
        if (!allowed()) return false
        main.post {
            hideNow()
            val view = withReplies(build(title, subtitle, voice, icon), onReply)
            add(view, Gravity.TOP or Gravity.END, dp(32), dp(28), focusable = onReply != null)
        }
        return true
    }

    /**
     * Message écrit : en haut au centre, texte en gros, retiré au bout de `seconds` secondes (au moins
     * Reponses.MESSAGE_MIN_MS avec des réponses), sauf si un autre bandeau l'a remplacé entre-temps ; false si
     * l'autorisation manque.
     */
    fun showMessage(title: String, text: String, seconds: Int, onReply: ((String) -> Unit)? = null): Boolean {
        if (!allowed()) return false
        main.post {
            hideNow()
            val view = withReplies(buildMessage(title, text), onReply)
            if (add(view, Gravity.TOP or Gravity.CENTER_HORIZONTAL, 0, dp(36), focusable = onReply != null)) {
                hideIn(Reponses.messageMs(seconds, onReply != null))
            }
        }
        return true
    }

    /**
     * Bandeau discret du mode film : en bas à gauche, petit et à demi transparent, retiré au bout de `durationMs` (sauf
     * si un autre bandeau l'a remplacé) ; false si l'autorisation manque.
     */
    fun showDiscreet(title: String, subtitle: String, icon: Int, durationMs: Long): Boolean {
        if (!allowed()) return false
        main.post {
            hideNow()
            val mine = generation
            val view = buildDiscreet(title, subtitle, icon)
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.BOTTOM or Gravity.START
                x = dp(24)
                y = dp(24)
            }
            runCatching { windows.addView(view, params) }.onSuccess {
                shown = view
                view.alpha = 0f
                view.animate().alpha(DISCREET_ALPHA).setDuration(400).start()
                main.postDelayed({ if (generation == mine) hideNow() }, durationMs)
            }
        }
        return true
    }

    fun hide() = main.post { hideNow() }

    /** Ajoute la fenêtre (focalisable s'il y a des réponses à choisir) ; false si le système la refuse. */
    private fun add(view: View, gravity: Int, x: Int, y: Int, focusable: Boolean): Boolean {
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // Focalisable (sans FLAG_NOT_FOCUSABLE) : la télécommande vient au bandeau ; le reste de l'écran ne change pas.
            if (focusable) WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
            else WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            this.gravity = gravity
            this.x = x
            this.y = y
        }
        return runCatching { windows.addView(view, params) }.onSuccess {
            shown = view
            view.alpha = 0f
            view.animate().alpha(1f).setDuration(250).start()
        }.isSuccess
    }

    /** Le bandeau s'en va dans `ms` (remplace la fin prévue). */
    private fun hideIn(ms: Long) {
        main.removeCallbacks(expire)
        expireAt = SystemClock.uptimeMillis() + ms
        main.postAtTime(expire, expireAt)
    }

    private fun hideNow() {
        generation++
        main.removeCallbacks(expire)
        expireAt = 0L
        offering = false
        animators.forEach { it.cancel() }
        animators.clear()
        shown?.let { runCatching { windows.removeView(it) } }
        shown = null
    }

    /**
     * Sans `onReply`, le bandeau tel quel. Avec : sous lui, les trois réponses et l'aide ; Retour masque, chaque touche
     * le garde au moins Reponses.IDLE_MS, et les touches restent au bandeau (rien ne part à l'appli dessous par erreur).
     */
    private fun withReplies(content: LinearLayout, onReply: ((String) -> Unit)?): View {
        if (onReply == null) return content
        offering = true
        val mine = generation // numéro de ce bandeau (hideNow vient de passer au suivant)
        val root = object : FrameLayout(context) {
            override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                    if (event.action == KeyEvent.ACTION_UP && generation == mine) hideNow()
                    return true
                }
                if (event.action == KeyEvent.ACTION_DOWN && expireAt > 0 && offering) {
                    hideIn(Reponses.afterKeyMs(expireAt - SystemClock.uptimeMillis()))
                }
                return super.dispatchKeyEvent(event)
            }
        }
        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = content.background
            elevation = content.elevation
            setPadding(0, 0, 0, dp(14))
        }
        content.background = null
        content.elevation = 0f
        column.addView(content)

        val buttons = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), 0, dp(18), 0)
        }
        val hint = TextView(context).apply {
            text = context.getString(R.string.reply_hint)
            setTextColor(color(R.color.fg_muted))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setPadding(dp(20), dp(8), dp(18), 0)
        }
        val choices = Reponses.CHOIX.map { choix ->
            Button(context).apply {
                text = choix.label
                isAllCaps = false
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                typeface = Typeface.DEFAULT_BOLD
                minHeight = 0
                minimumHeight = 0
                minWidth = 0
                minimumWidth = 0
                setPadding(dp(20), dp(8), dp(20), dp(8))
                // Bouton qui a le focus : plein, couleur pluie, contour clair ; les autres : discrets.
                background = StateListDrawable().apply {
                    addState(intArrayOf(android.R.attr.state_focused), GradientDrawable().apply {
                        cornerRadius = dp(999).toFloat()
                        setColor(color(R.color.rain))
                        setStroke(dp(3), color(R.color.fg))
                    })
                    addState(intArrayOf(), GradientDrawable().apply {
                        cornerRadius = dp(999).toFloat()
                        setColor(color(R.color.surface))
                        setStroke(dp(1), color(R.color.fg_muted))
                    })
                }
                setTextColor(color(R.color.fg))
                isFocusable = true
                setOnClickListener {
                    if (!offering || generation != mine) return@setOnClickListener
                    offering = false
                    onReply(choix.key)
                    buttons.removeAllViews()
                    hint.text = Reponses.sentText(choix.key)
                    hint.setTextColor(color(R.color.fg))
                    hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                    hideIn(Reponses.SENT_MS)
                }
            }
        }
        choices.forEachIndexed { i, button ->
            buttons.addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { if (i > 0) marginStart = dp(10) })
        }
        column.addView(buttons)
        column.addView(hint)
        root.addView(column)
        choices.first().let { first -> first.post { first.requestFocus() } }
        return root
    }

    private fun build(title: String, subtitle: String, voice: Boolean, iconRes: Int?): LinearLayout {
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
            setImageResource(iconRes ?: if (voice) R.drawable.ic_mic else R.drawable.ic_bell)
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

    private fun buildDiscreet(title: String, subtitle: String, iconRes: Int): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(8), dp(14), dp(8))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(color(R.color.surface_banner))
            }
        }
        val icon = ImageView(context).apply {
            setImageResource(iconRes)
            setPadding(dp(6), dp(6), dp(6), dp(6))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(color(R.color.rain))
            }
        }
        row.addView(icon, LinearLayout.LayoutParams(dp(28), dp(28)))
        val texts = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val widest = context.resources.displayMetrics.widthPixels / 3
        texts.addView(TextView(context).apply {
            text = title
            setTextColor(color(R.color.fg))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            maxWidth = widest
            maxLines = 1
        })
        if (subtitle.isNotBlank()) texts.addView(TextView(context).apply {
            text = subtitle
            setTextColor(color(R.color.fg_muted))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            maxWidth = widest
            maxLines = 3
        })
        row.addView(texts, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(10) })
        return row
    }

    private fun buildMessage(title: String, text: String): LinearLayout {
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

    private companion object {
        /** Opacité du bandeau discret : le film reste visible derrière. */
        const val DISCREET_ALPHA = 0.85f
    }
}
