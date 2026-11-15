// Minuteurs de la maison (fonction 3), partie sans Android, testée sur la JVM (MinuteurTest) : lecture des événements
// `timer`, `timer-clear` et `timers` (shared/screen.ts), file des minuteurs qui sonnent (le plus récent s'affiche, les
// autres attendent derrière), décompte des minuteurs en cours (à l'heure du serveur, sans dépendre de l'horloge de la
// télé) et le carillon court joué à l'arrivée (trois notes qui montent, son synthétisé : aucun fichier à embarquer).
package fr.homehub.tv

import org.json.JSONObject
import java.time.Instant
import java.util.Locale
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.roundToInt
import kotlin.math.sin

sealed interface TimerEvent {
    val id: String
    val timerId: String
    /** Minuteur terminé : bandeau « Cuisson », « C'est l'heure ! (10 min) », bouton « Arrêter ». */
    data class Ring(override val id: String, override val timerId: String, val title: String, val subtitle: String) : TimerEvent
    /** Minuteur arrêté ailleurs : son bandeau s'en va. */
    data class Clear(override val id: String, override val timerId: String) : TimerEvent
}

/** Événements de minuteur parmi ceux reçus (les autres genres sont lus par parseEvents). */
fun parseTimerEvents(json: String): List<TimerEvent> {
    val list = JSONObject(json).getJSONArray("events")
    return (0 until list.length()).map { list.getJSONObject(it) }.mapNotNull { e ->
        when (e.optString("kind")) {
            "timer" -> TimerEvent.Ring(e.getString("id"), e.getString("timerId"), e.getString("title"), e.getString("subtitle"))
            "timer-clear" -> TimerEvent.Clear(e.getString("id"), e.getString("timerId"))
            else -> null
        }
    }
}

/** Un minuteur qui tourne encore ; `endsAt` en millisecondes, à l'heure du serveur. */
data class RunningTimer(val timerId: String, val label: String, val endsAt: Long, val durationSeconds: Int)

/** Liste complète des minuteurs en cours (événement `timers`) ; `serverNow` : l'heure du serveur à l'envoi, en ms. */
data class RunningTimers(val id: String, val serverNow: Long, val timers: List<RunningTimer>)

/** Événements `timers` parmi ceux reçus, dans l'ordre (le dernier fait foi). */
fun parseRunningTimers(json: String): List<RunningTimers> {
    val list = JSONObject(json).getJSONArray("events")
    return (0 until list.length()).map { list.getJSONObject(it) }.filter { it.optString("kind") == "timers" }.map { e ->
        val timers = e.getJSONArray("timers")
        RunningTimers(
            e.getString("id"),
            Instant.parse(e.getString("serverNow")).toEpochMilli(),
            (0 until timers.length()).map { timers.getJSONObject(it) }.map {
                RunningTimer(it.getString("timerId"), it.getString("label"), Instant.parse(it.getString("endsAt")).toEpochMilli(), it.optInt("durationSeconds"))
            },
        )
    }
}

/** Ce que montre le petit minuteur en bas à droite : le plus proche de la fin, son temps restant, et combien d'autres. */
data class CountdownView(val label: String, val remaining: String, val others: Int)

/**
 * Décompte des minuteurs en cours, reçus à l'instant `receivedAt` d'une horloge monotone de la télé (elapsedRealtime) :
 * le temps du serveur avance comme elle, quelle que soit l'heure affichée par la télé.
 */
class Countdown(private val timers: List<RunningTimer>, serverNow: Long, receivedAt: Long) {
    private val offset = serverNow - receivedAt

    /** À l'instant `now` (même horloge que `receivedAt`) ; null : plus rien ne tourne. */
    fun at(now: Long): CountdownView? {
        val server = now + offset
        val left = timers.filter { it.endsAt > server }.sortedBy { it.endsAt }
        val first = left.firstOrNull() ?: return null
        return CountdownView(first.label, formatRemaining(first.endsAt - server), left.size - 1)
    }
}

/** Temps restant arrondi à la seconde supérieure (comme la tablette) : « 0:42 », « 9:05 », « 1:02:03 ». */
fun formatRemaining(ms: Long): String {
    val total = ((ms.coerceAtLeast(0) + 999) / 1000)
    val h = total / 3600
    val m = total % 3600 / 60
    val s = total % 60
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s) else String.format(Locale.ROOT, "%d:%02d", m, s)
}

/** Minuteurs qui sonnent sur la télé, dans l'ordre d'arrivée ; le bandeau montre le dernier arrivé. */
class TimerQueue {
    private val ringing = LinkedHashMap<String, TimerEvent.Ring>()

    /** Le minuteur à afficher, ou null : plus de bandeau. */
    val shown: TimerEvent.Ring? get() = ringing.values.lastOrNull()

    /** Ajoute un minuteur qui sonne ; false s'il était déjà là (événement reçu deux fois). */
    fun ring(event: TimerEvent.Ring): Boolean {
        val fresh = event.timerId !in ringing
        ringing[event.timerId] = event
        return fresh
    }

    /** Retire un minuteur (arrêté, masqué, ou arrêté ailleurs). */
    fun remove(timerId: String) {
        ringing.remove(timerId)
    }

    fun clear() = ringing.clear()
}

/** Fréquence d'échantillonnage du carillon. */
const val CHIME_RATE = 44_100

/** Notes du carillon (do, mi, sol aigus), durée de chacune et écart entre deux débuts, en ms. */
private val CHIME_NOTES = doubleArrayOf(1046.5, 1318.5, 1568.0)
private const val CHIME_NOTE_MS = 420
private const val CHIME_STEP_MS = 180

/** Le carillon en PCM 16 bits mono : chaque note s'éteint doucement ; un peu moins d'une seconde en tout. */
fun chime(rate: Int = CHIME_RATE, volume: Double = 0.6): ShortArray {
    val noteSamples = rate * CHIME_NOTE_MS / 1000
    val step = rate * CHIME_STEP_MS / 1000
    val total = step * (CHIME_NOTES.size - 1) + noteSamples
    val mix = DoubleArray(total)
    CHIME_NOTES.forEachIndexed { n, frequency ->
        for (i in 0 until noteSamples) {
            val t = i.toDouble() / rate
            // Attaque de 5 ms (pas de clic), puis décroissance ; fondu sur les 10 dernières ms.
            val attack = (t / 0.005).coerceAtMost(1.0)
            val release = ((noteSamples - i).toDouble() / (rate * 0.01)).coerceAtMost(1.0)
            mix[n * step + i] += sin(2 * PI * frequency * t) * exp(-t * 7) * attack * release
        }
    }
    val peak = mix.maxOf { kotlin.math.abs(it) }.coerceAtLeast(1e-9)
    return ShortArray(total) { (mix[it] / peak * volume * Short.MAX_VALUE).roundToInt().toShort() }
}
