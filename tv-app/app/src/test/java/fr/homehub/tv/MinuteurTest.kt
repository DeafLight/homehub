// Tests JVM de l'alerte des minuteurs : événements `timer` et `timer-clear` lus tels que les envoie HomeHub (les
// autres genres ignorés), file des minuteurs qui sonnent (le dernier arrivé s'affiche, doublon ignoré), carillon
// (durée, pas de saturation, début et fin sans clic).
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
