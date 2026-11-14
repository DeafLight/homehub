// Service d'accessibilité de HomeHub TV (activé par installer.ps1) : il suit l'appli au premier plan (bloc « En cours »
// de la télécommande) et sert de secours quand l'adb local est coupé (Retour, Accueil, verrouiller l'écran). Il ne lit
// aucun contenu d'écran : seulement le paquet de la fenêtre qui passe devant.
package fr.homehub.tv

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

class HomeHubAccessibility : AccessibilityService() {
    override fun onServiceConnected() {
        instance = this
        listener?.invoke()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        // Seulement les applis qu'on peut lancer (pas un clavier, une fenêtre du système ni notre bandeau).
        if (pkg == packageName || (packageManager.getLeanbackLaunchIntentForPackage(pkg) == null && packageManager.getLaunchIntentForPackage(pkg) == null)) return
        if (pkg != foreground) {
            foreground = pkg
            listener?.invoke()
        }
    }

    override fun onInterrupt() {}

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        listener?.invoke()
        return super.onUnbind(intent)
    }

    companion object {
        @Volatile var instance: HomeHubAccessibility? = null
            private set
        /** Dernière appli passée au premier plan. */
        @Volatile var foreground: String? = null
            private set
        /** Prévenu quand l'appli au premier plan change ou que le service se connecte (HubService). */
        @Volatile var listener: (() -> Unit)? = null
    }
}
