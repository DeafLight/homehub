// Applis du lanceur de la télé (CATEGORY_LEANBACK_LAUNCHER, visibles grâce à <queries> depuis Android 11) : nom, paquet
// et bannière en PNG 240×135 (l'icône centrée si l'appli n'a pas de bannière), pour le tiroir de la télécommande ; et le
// lancement d'une appli depuis le service, permis parce que l'appli peut afficher par-dessus les autres
// (SYSTEM_ALERT_WINDOW, accordé par installer.ps1).
package fr.homehub.tv

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.util.Base64
import java.io.ByteArrayOutputStream

object Applis {
    private const val WIDTH = 240
    private const val HEIGHT = 135
    /** Doit rester sous SCREEN_BANNER_MAX (shared/screen.ts). */
    private const val BANNER_MAX = 120_000

    fun list(context: Context): List<AppEntry> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        return pm.queryIntentActivities(intent, 0)
            .filter { it.activityInfo.packageName != context.packageName }
            .distinctBy { it.activityInfo.packageName }
            .map { info ->
                val activity = info.activityInfo
                val banner = activity.loadBanner(pm) ?: activity.applicationInfo.loadBanner(pm)
                val image = runCatching { png(context, banner, banner == null, activity.loadIcon(pm)) }.getOrNull()
                AppEntry(activity.packageName, info.loadLabel(pm).toString().ifBlank { activity.packageName }.take(60), image?.takeIf { it.length <= BANNER_MAX })
            }
            .sortedBy { it.name.lowercase() }
    }

    /** Bannière dessinée en 240×135 (ou l'icône centrée sur le fond du thème), en PNG base64. */
    private fun png(context: Context, banner: Drawable?, iconOnly: Boolean, icon: Drawable): String {
        val bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        if (!iconOnly && banner != null) {
            banner.setBounds(0, 0, WIDTH, HEIGHT)
            banner.draw(canvas)
        } else {
            canvas.drawColor(context.getColor(R.color.surface))
            val size = HEIGHT * 2 / 3
            icon.setBounds((WIDTH - size) / 2, (HEIGHT - size) / 2, (WIDTH + size) / 2, (HEIGHT + size) / 2)
            icon.draw(canvas)
        }
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        bitmap.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /** Ouvre l'appli `pkg` ; null si c'est fait, sinon la raison. */
    fun launch(context: Context, pkg: String): String? {
        val pm = context.packageManager
        val intent = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg) ?: return "appli absente de la télé"
        return try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED))
            null
        } catch (e: Exception) {
            "lancement refusé : ${e.message}"
        }
    }
}
