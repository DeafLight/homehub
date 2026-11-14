// Langage entre l'appli et son injecteur (Injecteur.kt, lancé par adb sous l'identité shell) : une ligne par ordre sur
// l'entrée du programme (« key 20 20 23 », « text <base64> », « ping »), une ligne de réponse sur sa sortie (« ready »
// au démarrage, puis « ok » ou « err <raison> »). Et les touches de la télécommande (shared/screen.ts, REMOTE_KEYS)
// traduites en codes Android. Fonctions pures, testées sur la JVM (RemoteTest).
package fr.homehub.tv

import java.text.Normalizer
import java.util.Base64

object RemoteKeys {
    // Codes de android.view.KeyEvent, recopiés pour rester testables sur la JVM.
    const val HOME = 3
    const val BACK = 4
    const val DPAD_UP = 19
    const val DPAD_DOWN = 20
    const val DPAD_LEFT = 21
    const val DPAD_RIGHT = 22
    const val DPAD_CENTER = 23
    const val VOLUME_UP = 24
    const val VOLUME_DOWN = 25
    const val ENTER = 66
    const val MEDIA_PLAY_PAUSE = 85
    const val MEDIA_PAUSE = 127
    const val VOLUME_MUTE = 164
    const val SLEEP = 223
    const val WAKEUP = 224

    /** Touches de shared/screen.ts (REMOTE_KEYS) → codes Android. */
    val CODES: Map<String, Int> = mapOf(
        "up" to DPAD_UP,
        "down" to DPAD_DOWN,
        "left" to DPAD_LEFT,
        "right" to DPAD_RIGHT,
        "ok" to DPAD_CENTER,
        "back" to BACK,
        "home" to HOME,
        "playpause" to MEDIA_PLAY_PAUSE,
        "pause" to MEDIA_PAUSE,
        "volup" to VOLUME_UP,
        "voldown" to VOLUME_DOWN,
        "mute" to VOLUME_MUTE,
    )

    /** Codes des touches connues ; une touche inconnue (serveur plus récent) est ignorée. */
    fun codes(keys: List<String>): List<Int> = keys.mapNotNull { CODES[it] }
}

/** Nom de la classe lancée par app_process (doit rester celui d'Injecteur.kt). */
const val INJECTOR_CLASS = "fr.homehub.tv.Injecteur"

/** Commande du flux adb qui lance l'injecteur depuis l'APK installé (chemin donné par le système). */
fun injectorShell(apkPath: String): String = "CLASSPATH=$apkPath app_process / $INJECTOR_CLASS"

/**
 * Texte tel que l'injecteur sait l'écrire : le clavier virtuel d'Android n'a pas de touches pour les lettres
 * accentuées, elles perdent leur accent (« Télé » → « Tele » : les recherches des applis l'ignorent) ; ligatures
 * dépliées, retours à la ligne changés en espaces.
 */
fun plainText(text: String): String =
    Normalizer.normalize(text.replace("œ", "oe").replace("Œ", "OE").replace("æ", "ae").replace("Æ", "AE"), Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}+"), "")
        .replace(Regex("[\\r\\n\\t]+"), " ")

sealed interface InjectorCommand {
    data class Keys(val codes: List<Int>) : InjectorCommand
    data class Text(val text: String) : InjectorCommand
    data object Ping : InjectorCommand
}

fun keysLine(codes: List<Int>): String = "key " + codes.joinToString(" ")

fun textLine(text: String): String = "text " + Base64.getEncoder().encodeToString(plainText(text).toByteArray(Charsets.UTF_8))

/** Ordre lu par l'injecteur ; null : ligne vide ou inconnue. */
fun parseCommand(line: String): InjectorCommand? {
    val parts = line.trim().split(' ', limit = 2)
    return when (parts[0]) {
        "key" -> parts.getOrNull(1)?.split(' ')?.mapNotNull { it.toIntOrNull() }?.takeIf { it.isNotEmpty() }?.let { InjectorCommand.Keys(it) }
        "text" -> parts.getOrNull(1)?.let { runCatching { InjectorCommand.Text(Base64.getDecoder().decode(it).toString(Charsets.UTF_8)) }.getOrNull() }
        "ping" -> InjectorCommand.Ping
        else -> null
    }
}

sealed interface InjectorReply {
    data object Ready : InjectorReply
    data object Ok : InjectorReply
    data class Failed(val reason: String) : InjectorReply
}

/** Réponse de l'injecteur ; null : autre chose (écho d'un terminal, message du système). */
fun parseReply(line: String): InjectorReply? {
    val trimmed = line.trim()
    return when {
        trimmed == "ready" -> InjectorReply.Ready
        trimmed == "ok" -> InjectorReply.Ok
        trimmed.startsWith("err ") -> InjectorReply.Failed(trimmed.removePrefix("err ").trim())
        else -> null
    }
}
