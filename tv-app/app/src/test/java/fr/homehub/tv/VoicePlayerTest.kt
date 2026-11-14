// Tests JVM du garde-fou de lecture de HomeHub TV : délai après lequel un message vocal est terminé d'office, pour que
// le bandeau disparaisse toujours.
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class VoicePlayerTest {
    @Test
    fun dureeConnueEtMarge() {
        assertEquals(4_000L, watchdogMs(1_000))
        assertEquals(33_000L, watchdogMs(30_000))
    }

    @Test
    fun dureeInconnue() {
        assertEquals(40_000L, watchdogMs(-1))
        assertEquals(40_000L, watchdogMs(0))
    }
}
