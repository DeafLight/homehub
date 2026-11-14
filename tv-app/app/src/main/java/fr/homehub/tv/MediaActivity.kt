// Écran plein écran d'une photo ou d'une vidéo partagée depuis un téléphone (fonction 11). La photo, décodée à la
// taille de l'écran (ImageDecoder : orientation EXIF, HEIC, GIF animé), reste au plus le temps donné par HomeHub ; la
// vidéo se lit avec un focus audio transitoire (le programme se met en pause, ou baisse, et reprend après) et se ferme
// à sa fin. Retour à la télécommande ferme tout de suite. Le bandeau « Photo d'Alex » s'efface après quelques
// secondes. Lancé par HubService (autorisé en arrière-plan grâce à « afficher par-dessus ») ; il rend compte par la
// MediaSession de l'envoi. Couleurs du thème sombre de HomeHub.
package fr.homehub.tv

import android.app.Activity
import android.graphics.ImageDecoder
import android.graphics.Typeface
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.VideoView
import java.io.File
import java.lang.ref.WeakReference

class MediaActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private var session: MediaSession? = null
    private val closeLater = Runnable { finish() }

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val found = MediaSessions.get(intent.getStringExtra(EXTRA_EVENT))
        if (found == null) return finish()
        session = found
        current = WeakReference(this)
        val root = FrameLayout(this).apply { setBackgroundColor(getColor(android.R.color.black)) }
        setContentView(root)
        val title = titleView(found.event.title)
        if (found.event.video) showVideo(root, found) else showPhoto(root, found)
        root.addView(title, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
            leftMargin = dp(32)
            topMargin = dp(28)
        })
        main.postDelayed({ title.animate().alpha(0f).setDuration(400).start() }, MEDIA_TITLE_MS)
        main.postDelayed(closeLater, closeDelayMs(found.event.seconds))
    }

    private fun titleView(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(getColor(R.color.fg))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        typeface = Typeface.DEFAULT_BOLD
        setPadding(dp(20), dp(12), dp(20), dp(12))
        background = GradientDrawable().apply {
            cornerRadius = dp(18).toFloat()
            setColor(getColor(R.color.surface_banner))
        }
    }

    private fun showPhoto(root: FrameLayout, session: MediaSession) {
        val image = ImageView(this).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
        root.addView(image, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val metrics = resources.displayMetrics
        Thread({
            val drawable = runCatching {
                ImageDecoder.decodeDrawable(ImageDecoder.createSource(File(session.path))) { decoder, info, _ ->
                    val (w, h) = fitSize(info.size.width, info.size.height, metrics.widthPixels, metrics.heightPixels)
                    decoder.setTargetSize(w, h)
                }
            }
            main.post {
                if (isDestroyed) return@post
                drawable.onSuccess {
                    image.setImageDrawable(it)
                    (it as? AnimatedImageDrawable)?.start()
                    session.shown()
                }.onFailure {
                    session.failed("photo illisible : ${it.message}")
                    finish()
                }
            }
        }, "homehub-photo").start()
    }

    private fun showVideo(root: FrameLayout, session: MediaSession) {
        val video = VideoView(this)
        root.addView(video, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        // Transitoire : l'appli en cours se met en pause (ou baisse le son) et reprend à la fermeture.
        video.setAudioFocusRequest(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        video.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build())
        video.setOnPreparedListener {
            video.start()
            session.shown()
        }
        video.setOnCompletionListener { finish() }
        video.setOnErrorListener { _, what, extra ->
            session.failed("vidéo illisible sur cette télé ($what/$extra)")
            finish()
            true
        }
        video.setVideoPath(session.path)
        video.visibility = View.VISIBLE
    }

    override fun onStop() {
        super.onStop()
        // Une autre appli passe devant (Accueil, appli lancée par la télécommande) : on ne reste pas en dessous.
        if (!isFinishing) finish()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        if (current?.get() === this) current = null
        session?.close()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_EVENT = "event"
        @Volatile private var current: WeakReference<MediaActivity>? = null

        /** Ferme la photo ou la vidéo à l'écran (une nouvelle arrive). */
        fun closeCurrent() {
            current?.get()?.let { activity -> activity.runOnUiThread { activity.finish() } }
        }
    }
}
