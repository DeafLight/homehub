// Tests JVM des minuteurs : événements `timer`, `timer-clear` et `timers` lus tels que les envoie HomeHub (les
// autres genres ignorés), file des minuteurs qui sonnent (le dernier arrivé s'affiche, doublon ignoré), décompte des
// minuteurs en cours à l'heure du serveur (horloge de la télé décalée sans effet, « +1 », fin), format du temps
// restant, carillon (durée, pas de saturation, début et fin sans clic).
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class MinuteurTest {
    @Test
    fun evenementsDeMinuteur() {
        val events = parseTimerEvents(
            """{"events":[
              {"seq":3,"kind":"voice","id":"e1","title":"Message d’Alex","audio":"/api/screen/clips/abc.webm","contentType":"audio/webm"},
              {"seq":4,"kind":"timer","id":"e2","timerId":"t1","title":"Cuisson","subtitle":"C’est l’heure ! (10 min)"},
              {"seq":5,"kind":"timer-clear","id":"e3","timerId":"t1"},
              {"seq":6,"kind":"inconnu","id":"e4"}
            ],"last":6}""",
        )
        assertEquals(
            listOf(TimerEvent.Ring("e2", "t1", "Cuisson", "C’est l’heure ! (10 min)"), TimerEvent.Clear("e3", "t1")),
            events,
        )
        assertEquals(emptyList<TimerEvent>(), parseTimerEvents("""{"events":[],"last":0}"""))
    }

    @Test
    fun minuteursEnCours() {
        val json = """{"events":[
          {"seq":7,"kind":"timers","id":"e1","serverNow":"2026-03-09T16:00:00.000Z","timers":[]},
          {"seq":8,"kind":"timers","id":"e2","serverNow":"2026-03-09T16:00:00.000Z","timers":[
            {"timerId":"t1","label":"Pâtes","endsAt":"2026-03-09T16:09:05.000Z","durationSeconds":600},
            {"timerId":"t2","label":"Écrans","endsAt":"2026-03-09T16:30:00.000Z","durationSeconds":1800}
          ]},
          {"seq":9,"kind":"timer","id":"e3","timerId":"t0","title":"Cuisson","subtitle":"C’est l’heure !"}
        ],"last":9}"""
        val events = parseRunningTimers(json)
        assertEquals(listOf("e1", "e2"), events.map { it.id })
        assertEquals(emptyList<RunningTimer>(), events[0].timers)
        val now = 1_773_072_000_000L // 2026-03-09T16:00:00Z
        assertEquals(now, events[1].serverNow)
        assertEquals(RunningTimer("t1", "Pâtes", now + 545_000, 600), events[1].timers[0])
        assertEquals(listOf(TimerEvent.Ring("e3", "t0", "Cuisson", "C’est l’heure !")), parseTimerEvents(json))
    }

    @Test
    fun decompteALHeureDuServeur() {
        val serverNow = 1_773_072_000_000L
        val timers = listOf(RunningTimer("t2", "Écrans", serverNow + 1_800_000, 1800), RunningTimer("t1", "Pâtes", serverNow + 545_000, 600))
        // Horloge monotone de la télé : sans rapport avec l'heure du serveur.
        val countdown = Countdown(timers, serverNow, receivedAt = 12_345L)
        assertEquals(CountdownView("Pâtes", "9:05", 1), countdown.at(12_345L))
        assertEquals(CountdownView("Pâtes", "9:04", 1), countdown.at(12_345L + 1_000))
        assertEquals(CountdownView("Pâtes", "0:01", 1), countdown.at(12_345L + 544_500))
        // Pâtes terminé : il sonne (bandeau d'alerte), le petit minuteur passe à Écrans.
        assertEquals(CountdownView("Écrans", "20:55", 0), countdown.at(12_345L + 545_000))
        assertNull(countdown.at(12_345L + 1_800_000))
        assertNull(Countdown(emptyList(), serverNow, 0).at(0))
    }

    @Test
    fun tempsRestant() {
        assertEquals("0:00", formatRemaining(-5))
        assertEquals("0:01", formatRemaining(1))
        assertEquals("0:42", formatRemaining(42_000))
        assertEquals("10:00", formatRemaining(600_000))
        assertEquals("1:02:03", formatRemaining(3_723_000))
    }

    @Test
    fun fileDesMinuteurs() {
        val queue = TimerQueue()
        assertNull(queue.shown)
        val pates = TimerEvent.Ring("e1", "t1", "Pâtes", "C’est l’heure !")
        val ecrans = TimerEvent.Ring("e2", "t2", "Écrans", "C’est l’heure ! (30 min)")
        assertTrue(queue.ring(pates))
        assertTrue(queue.ring(ecrans))
        assertFalse(queue.ring(pates.copy(id = "e3")))
        assertEquals("t2", queue.shown?.timerId)
        queue.remove("t2")
        assertEquals("t1", queue.shown?.timerId)
        queue.remove("inconnu")
        queue.remove("t1")
        assertNull(queue.shown)
    }

    @Test
    fun carillonCourtSansSaturationNiClic() {
        val samples = chime(rate = 8_000)
        // Trois notes de 420 ms, la suivante 180 ms après : 780 ms.
        assertEquals(8_000 * 780 / 1000, samples.size)
        val peak = samples.maxOf { abs(it.toInt()) }
        assertTrue("crête $peak", peak in 15_000..Short.MAX_VALUE.toInt())
        assertTrue(abs(samples.first().toInt()) < 500)
        assertTrue(abs(samples.last().toInt()) < 500)
    }
}
