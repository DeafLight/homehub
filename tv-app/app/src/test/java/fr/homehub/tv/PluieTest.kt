// Tests de la lecture des alertes pluie (Pluie.kt) : seules les « rain » sont gardées, durée bornée.
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class PluieTest {
    private val json = """
        {"events":[
          {"seq":1,"kind":"voice","id":"v1","title":"Message d’Alex","audio":"/api/screen/voice/a.webm","contentType":"audio/webm"},
          {"seq":2,"kind":"rain","id":"r1","title":"Pluie vers 8 h","subtitle":"Prenez un parapluie","seconds":60}
        ],"last":2}
    """.trimIndent()

    @Test
    fun gardeLesAlertesPluie() {
        assertEquals(listOf(RainEvent("r1", "Pluie vers 8 h", "Prenez un parapluie", 60)), parseRainEvents(json))
    }

    @Test
    fun parseEventsLesIgnore() {
        val events = parseEvents(json)
        assertEquals(1, events.voices.size)
        assertEquals(0, events.remote.size)
    }

    @Test
    fun dureeBornee() {
        assertEquals(60_000L, rainBannerMs(RainEvent("r", "t", "s", 60)))
        assertEquals(5_000L, rainBannerMs(RainEvent("r", "t", "s", 0)))
        assertEquals(300_000L, rainBannerMs(RainEvent("r", "t", "s", 9999)))
    }
}
