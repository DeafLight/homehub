// Protocole entre l'appli et HomeHub (shared/screen.ts côté serveur) : en-tête de version, lecture des réponses JSON,
// compte rendu. Fonctions pures, testées sur la JVM (ProtocolTest).
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

data class Events(val voices: List<VoiceEvent>, val last: Int)

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
    val voices = (0 until list.length()).map { list.getJSONObject(it) }.filter { it.optString("kind") == "voice" }.map {
        VoiceEvent(it.getInt("seq"), it.getString("id"), it.getString("title"), it.getString("audio"), it.getString("contentType"))
    }
    return Events(voices, o.getInt("last"))
}

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
