// Protocole entre l'appli et HomeHub (shared/screen.ts côté serveur) : en-tête de version, lecture des réponses JSON
// (messages vocaux et ordres de la télécommande), compte rendu, état de la télé et liste de ses applis. Fonctions pures, testées sur la JVM (ProtocolTest).
package fr.homehub.tv

import org.json.JSONArray
import org.json.JSONObject

object Protocol {
    /** Doit valoir SCREEN_PROTOCOL de shared/screen.ts. */
    const val VERSION = 1
    const val HEADER = "X-HomeHub-Screen"
}

data class PairingStart(val id: String, val code: String, val expiresAt: String)

sealed interface PairingState {
    data object Pending : PairingState
    data class Paired(val token: String, val screenId: String, val name: String) : PairingState
}

/** Message vocal à télécharger à `audio` (chemin de l'API) ; `title` : « Message d'Alex ». */
data class VoiceEvent(val seq: Int, val id: String, val title: String, val audio: String, val contentType: String)

/** Ordres de la télécommande du téléphone (shared/screen.ts : key, text, launch, power). */
sealed interface RemoteEvent {
    val id: String
    data class Keys(override val id: String, val keys: List<String>, val notice: Notice?) : RemoteEvent
    data class Text(override val id: String, val text: String, val submit: Boolean) : RemoteEvent
    data class Launch(override val id: String, val pkg: String) : RemoteEvent
    data class Power(override val id: String, val on: Boolean) : RemoteEvent
}

/** Bandeau qui accompagne des touches (« À table ! », « De la part d'Alex »). */
data class Notice(val title: String, val subtitle: String)

data class Events(val voices: List<VoiceEvent>, val last: Int, val remote: List<RemoteEvent> = emptyList())

/** Une appli du lanceur, pour le tiroir de la télécommande ; `banner` : PNG en base64. */
data class AppEntry(val pkg: String, val name: String, val banner: String?)

fun parsePairingStart(json: String): PairingStart {
    val o = JSONObject(json)
    return PairingStart(o.getString("id"), o.getString("code"), o.getString("expiresAt"))
}

fun parsePairingState(json: String): PairingState {
    val o = JSONObject(json)
    return when (o.getString("status")) {
        "paired" -> {
            val screen = o.getJSONObject("screen")
            PairingState.Paired(o.getString("token"), screen.getString("id"), screen.getString("name"))
        }
        else -> PairingState.Pending
    }
}

/** Événements reçus ; ceux d'un genre inconnu (appli plus ancienne que le serveur) sont ignorés. */
fun parseEvents(json: String): Events {
    val o = JSONObject(json)
    val list: JSONArray = o.getJSONArray("events")
    val all = (0 until list.length()).map { list.getJSONObject(it) }
    val voices = all.filter { it.optString("kind") == "voice" }.map {
        VoiceEvent(it.getInt("seq"), it.getString("id"), it.getString("title"), it.getString("audio"), it.getString("contentType"))
    }
    val remote = all.mapNotNull { e ->
        val id = e.getString("id")
        when (e.optString("kind")) {
            "key" -> {
                val keys = e.getJSONArray("keys")
                val notice = e.optJSONObject("notice")?.let { Notice(it.getString("title"), it.getString("subtitle")) }
                RemoteEvent.Keys(id, (0 until keys.length()).map { keys.getString(it) }, notice)
            }
            "text" -> RemoteEvent.Text(id, e.getString("text"), e.optBoolean("submit"))
            "launch" -> RemoteEvent.Launch(id, e.getString("package"))
            "power" -> RemoteEvent.Power(id, e.getBoolean("on"))
            else -> null
        }
    }
    return Events(voices, o.getInt("last"), remote)
}

/** État de la télé pour HomeHub (shared/screen.ts, ScreenStateReport). */
fun stateJson(screenOn: Boolean, foreground: String?, control: String, addresses: List<String>): String =
    JSONObject().apply {
        put("screenOn", screenOn)
        put("foreground", foreground ?: JSONObject.NULL)
        put("control", control)
        put("addresses", JSONArray(addresses.take(8)))
    }.toString()

/** Liste des applis pour HomeHub (shared/screen.ts, ScreenAppsReport), au plus 80. */
fun appsJson(apps: List<AppEntry>): String =
    JSONObject().put(
        "apps",
        JSONArray(apps.take(80).map { JSONObject().put("package", it.pkg).put("name", it.name).put("banner", it.banner ?: JSONObject.NULL) }),
    ).toString()

/** Message d'erreur de HomeHub ({ "error": "…" }), ou le statut HTTP. */
fun errorMessage(status: Int, body: String?): String =
    body?.let { runCatching { JSONObject(it).optString("error") }.getOrNull() }?.takeIf { it.isNotBlank() } ?: "HTTP $status"

fun reportJson(ok: Boolean, reason: String? = null): String =
    JSONObject().apply {
        put("ok", ok)
        if (!ok) put("reason", (reason ?: "Erreur inconnue").take(200))
    }.toString()

/** Adresse de HomeHub telle que donnée par adb : « homehub.exemple » → « http://homehub.exemple », sans « / » final. */
fun normalizeServer(raw: String): String? {
    val trimmed = raw.trim().trimEnd('/')
    if (trimmed.isEmpty()) return null
    val withScheme = if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) trimmed else "http://$trimmed"
    val url = Regex("^https?://([A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*|\\[[0-9A-Fa-f:.]+])(:\\d{1,5})?(/\\S*)?$", RegexOption.IGNORE_CASE)
    return withScheme.takeIf { url.matches(it) }
}
