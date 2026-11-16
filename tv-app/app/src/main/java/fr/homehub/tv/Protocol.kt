// Protocole entre l'appli et HomeHub (shared/screen.ts côté serveur) : en-tête de version, lecture des réponses JSON
// (messages écrits avec leurs réponses rapides, ordres de la télécommande, alerte du bus, séance de sport, parler en direct), compte rendu (refus écran éteint compris), état de la télé et liste de ses applis. Fonctions pures, testées sur la JVM (ProtocolTest).
// `discreet` (mode film, fonction 15) : ajouté par HomeHub aux bandeaux pendant un film, voir Film.kt.
package fr.homehub.tv

import org.json.JSONArray
import org.json.JSONObject

object Protocol {
    /** Doit valoir SCREEN_PROTOCOL de shared/screen.ts. */
    const val VERSION = 1
    const val HEADER = "X-HomeHub-Screen"
    /** Refus d'une prise de parole écran éteint ; doit valoir SCREEN_OFF_REASON de shared/screen.ts. */
    const val SCREEN_OFF = "écran éteint"
}

/**
 * Compte rendu d'une prise de parole avant de l'ouvrir : écran éteint (veille rapide, réseau gardé), personne ne la
 * verrait ni ne l'entendrait, elle est refusée ; écran allumé : null, on l'ouvre.
 */
fun screenOffRefusal(screenOn: Boolean): String? = if (screenOn) null else reportJson(false, Protocol.SCREEN_OFF)

data class PairingStart(val id: String, val code: String, val expiresAt: String)

sealed interface PairingState {
    data object Pending : PairingState
    data class Paired(val token: String, val screenId: String, val name: String) : PairingState
}

/** Ordres de la télécommande du téléphone (shared/screen.ts : key, text, launch, power). */
sealed interface RemoteEvent {
    val id: String
    data class Keys(override val id: String, val keys: List<String>, val notice: Notice?) : RemoteEvent
    data class Text(override val id: String, val text: String, val submit: Boolean) : RemoteEvent
    data class Launch(override val id: String, val pkg: String) : RemoteEvent
    data class Power(override val id: String, val on: Boolean) : RemoteEvent
    /** Séance de sport (fonction 12) : ouvrir la page `page` (start), ou la fermer et tout effacer (end). */
    data class Workout(override val id: String, val start: Boolean, val page: String, val notice: Notice?) : RemoteEvent
}

/** Bandeau qui accompagne des touches (« À table ! », « De la part d'Alex »). */
data class Notice(val title: String, val subtitle: String)

/**
 * Message écrit (fonction 2) : bandeau `title` (« Message d'Alex ») et `text` (déjà nettoyé par le serveur), affiché
 * `seconds` secondes (ramenées entre 3 et 60, comme tv.seconds côté serveur). `replyId` : réponses rapides proposées.
 */
data class MessageEvent(val id: String, val title: String, val text: String, val seconds: Int, val replyId: String? = null, val discreet: Boolean = false)

/** Identifiant de réponse d'un événement (absent, vide ou null : pas de réponses rapides). */
private fun JSONObject.replyId(): String? = if (has("replyId") && !isNull("replyId")) getString("replyId").takeIf { it.isNotBlank() } else null

/** Alerte du bus du matin (shared/screen.ts, ScreenBusEvent) : bandeau « Bus dans 9 min » pendant `seconds` s. */
data class BusEvent(val id: String, val title: String, val subtitle: String, val seconds: Int, val discreet: Boolean = false)

data class Events(
    val last: Int,
    val remote: List<RemoteEvent> = emptyList(),
    val messages: List<MessageEvent> = emptyList(),
    val bus: List<BusEvent> = emptyList(),
    /** Parler en direct (fonction 9, LiveTalk.kt). */
    val talks: List<TalkEvent> = emptyList(),
)

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
            "workout" -> {
                val notice = e.optJSONObject("notice")?.let { Notice(it.getString("title"), it.getString("subtitle")) }
                RemoteEvent.Workout(id, e.getString("action") == "start", e.getString("page"), notice)
            }
            else -> null
        }
    }
    val messages = all.filter { it.optString("kind") == "message" }.map {
        MessageEvent(it.getString("id"), it.getString("title"), it.getString("text"), it.optInt("seconds", 10).coerceIn(3, 60), it.replyId(), it.optBoolean("discreet"))
    }
    val bus = all.filter { it.optString("kind") == "bus" }.map {
        BusEvent(it.getString("id"), it.getString("title"), it.getString("subtitle"), it.optInt("seconds", 45).coerceIn(5, 120), it.optBoolean("discreet"))
    }
    val talks = all.filter { it.optString("kind") == "talk" }.map {
        TalkEvent(it.getString("id"), it.getString("title"), it.getString("audio"), it.optInt("rate", TALK_RATE))
    }
    return Events(o.getInt("last"), remote, messages, bus, talks)
}

/**
 * État de la télé pour HomeHub (shared/screen.ts, ScreenStateReport) ; `volume` : « adjustable » ou « fixed »
 * (Volume.kt) ; `nowPlaying` : ce qui passe (fonction 18, Lecture.kt), toujours présent (null : rien).
 */
fun stateJson(screenOn: Boolean, foreground: String?, control: String, addresses: List<String>, volume: String? = null, nowPlaying: Lecture? = null): String =
    JSONObject().apply {
        put("screenOn", screenOn)
        put("foreground", foreground ?: JSONObject.NULL)
        put("control", control)
        put("addresses", JSONArray(addresses.take(8)))
        volume?.let { put("volume", it) }
        put("nowPlaying", lectureJson(nowPlaying))
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
