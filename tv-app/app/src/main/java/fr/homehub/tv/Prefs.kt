// Réglages gardés sur la télé : adresse de HomeHub (donnée par adb), jeton et nom de la télé (reçus à l'appairage),
// dernier état du service (affiché par l'écran d'accueil).
package fr.homehub.tv

import android.content.Context

class Prefs(context: Context) {
    private val prefs = context.getSharedPreferences("homehub", Context.MODE_PRIVATE)

    var server: String?
        get() = prefs.getString("server", null)
        set(value) = prefs.edit().putString("server", value).apply()

    var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit().putString("token", value).apply()

    var screenName: String?
        get() = prefs.getString("screenName", null)
        set(value) = prefs.edit().putString("screenName", value).apply()

    /** Dernier état du service, en clair (« Connectée », « HomeHub injoignable… »). */
    var status: String?
        get() = prefs.getString("status", null)
        set(value) = prefs.edit().putString("status", value).apply()

    fun forgetPairing() {
        prefs.edit().remove("token").remove("screenName").apply()
    }
}
