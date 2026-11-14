// Tests JVM de « Parler en direct » : lecture de l'événement `talk`, attente du début (0,3 s de son), retard jeté au-delà
// d'une seconde, nouvelle attente après un silence du réseau, tailles toujours paires.
package fr.homehub.tv

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveTalkTest {
    private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

    @Test
    fun litLEvenementTalk() {
        val events = parseEvents(
            """{"events":[{"seq":3,"kind":"talk","id":"t1","title":"Alex vous parle","audio":"/api/screen/talk/t1","rate":16000}],"last":3}""",
        )
        assertEquals(listOf(TalkEvent("t1", "Alex vous parle", "/api/screen/talk/t1", 16_000)), events.talks)
        assertTrue(events.voices.isEmpty())
        assertTrue(events.remote.isEmpty())
    }

    @Test
    fun attendAssezDeSonAvantDeJouer() {
        val pacer = TalkPacer(prefillBytes = 4, maxLagBytes = 100)
        assertEquals(0, pacer.feed(bytes(1, 2)).size)
        assertFalse(pacer.playing)
        assertArrayEquals(bytes(1, 2, 3, 4), pacer.feed(bytes(3, 4)))
        assertTrue(pacer.playing)
        assertArrayEquals(bytes(5, 6), pacer.feed(bytes(5, 6)))
    }

    @Test
    fun jetteLeRetardAuDelaDuMaximum() {
        val pacer = TalkPacer(prefillBytes = 2, maxLagBytes = 4)
        assertArrayEquals(bytes(5, 6, 7, 8), pacer.feed(bytes(1, 2, 3, 4, 5, 6, 7, 8)))
        // Maximum impair : arrondi à un nombre pair d'octets.
        assertArrayEquals(bytes(3, 4, 5, 6), TalkPacer(2, 5).feed(bytes(1, 2, 3, 4, 5, 6)))
    }

    @Test
    fun reattendApresUnSilence() {
        val pacer = TalkPacer(prefillBytes = 4, maxLagBytes = 100)
        pacer.feed(bytes(1, 2, 3, 4))
        pacer.gap()
        assertFalse(pacer.playing)
        assertEquals(0, pacer.feed(bytes(9, 9)).size)
        assertArrayEquals(bytes(9, 9, 8, 8), pacer.feed(bytes(8, 8)))
    }

    @Test
    fun debitDuFormat() {
        assertEquals(32_000, talkBytesPerSecond(TALK_RATE))
    }
}
