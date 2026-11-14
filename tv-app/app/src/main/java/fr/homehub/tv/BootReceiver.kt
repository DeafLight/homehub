// Démarre le service au démarrage de la télé et après une mise à jour de l'appli (adb install -r), si elle est appairée.
package fr.homehub.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            HubService.startIfPaired(context)
        }
    }
}
