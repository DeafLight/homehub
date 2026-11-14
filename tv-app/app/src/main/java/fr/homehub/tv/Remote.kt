// Langage entre l'appli et son injecteur (Injecteur.kt, lancé par adb sous l'identité shell) : une ligne par ordre sur
// l'entrée du programme (« key 20 20 23 », « text <base64> », « ping »), une ligne de réponse sur sa sortie (« ready »
// au démarrage, puis « ok » ou « err <raison> »). Et les touches de la télécommande (shared/screen.ts, REMOTE_KEYS)
// traduites en codes Android, et le plan de frappe d'un texte (vidage du champ, pauses entre les caractères). Fonctions
// pures, testées sur la JVM (RemoteTest).
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
    const val DEL = 67
    const val MOVE_END = 123
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

/** Une étape de la frappe d'un texte par l'injecteur. */
sealed interface TypingStep {
    /** Touche (code Android). */
    data class Key(val code: Int) : TypingStep
    /** Caractère, changé en touches du clavier virtuel par l'injecteur. */
    data class Char(val char: kotlin.Char) : TypingStep
    data class Pause(val ms: Long) : TypingStep
}

object Typing {
    /** Pause entre deux touches d'une rafale : certaines applis ignorent des touches trop rapprochées. */
    const val KEY_GAP_MS = 12L
    /**
     * Retours arrière pour vider le champ : de quoi effacer une recherche précédente (les recherches des applis tiennent
     * en quelques mots). Ctrl+A n'est pas pris par tous les champs des applis de la télé et peut écrire un « a ».
     */
    const val CLEAR_DELETES = 40
    /** Pause entre deux caractères : le champ de recherche se met à jour à chaque lettre. */
    const val CHAR_GAP_MS = 40L
    /**
     * Pause après le vidage et après le premier caractère : la recherche ouvre ou rafraîchit ses suggestions et perd la
     * touche suivante si elle arrive trop tôt (deuxième lettre perdue sur la vraie télé en 0.73.1).
     */
    const val SETTLE_MS = 350L

    /** Vider le champ qui a le focus (curseur au bout, puis retours arrière), puis écrire `text` caractère par caractère. */
    fun plan(text: String): List<TypingStep> = buildList {
        add(TypingStep.Key(RemoteKeys.MOVE_END))
        repeat(CLEAR_DELETES) {
            add(TypingStep.Pause(KEY_GAP_MS))
            add(TypingStep.Key(RemoteKeys.DEL))
        }
        text.forEachIndexed { i, c ->
            add(TypingStep.Pause(if (i <= 1) SETTLE_MS else CHAR_GAP_MS))
            add(TypingStep.Char(c))
        }
    }

    /** Somme des pauses d'un plan : l'appli attend le compte rendu de l'injecteur au moins ce temps-là. */
    fun pausesMs(plan: List<TypingStep>): Long = plan.sumOf { (it as? TypingStep.Pause)?.ms ?: 0L }
}

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
