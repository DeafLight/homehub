// Tests des rappels : lecture des événements « reminder » parmi les autres, durée du bandeau bornée.
package fr.homehub.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class RappelsTest {
    @Test
    fun rappelsParmiLesAutresEvenements() {
        val json = """{"events":[
            {"seq":1,"kind":"message","id":"v","title":"Message d'Alex","text":"Coucou","seconds":10},
            {"seq":2,"kind":"reminder","id":"r","reminder":"evening-routine","title":"Routine du soir","subtitle":"Léa : encore 2 étapes","seconds":20}
        ],"last":2}"""
        assertEquals(listOf(ReminderEvent("r", "evening-routine", "Routine du soir", "Léa : encore 2 étapes", 20)), parseReminders(json))
        // Les messages écrits restent lus comme avant, le rappel n'y figure pas.
        assertEquals(1, parseEvents(json).messages.size)
        assertEquals(emptyList<RemoteEvent>(), parseEvents(json).remote)
    }

    @Test
    fun dureeBornee() {
        assertEquals(20_000L, Rappels.durationMs(20))
        assertEquals(Rappels.MIN_MS, Rappels.durationMs(0))
        assertEquals(Rappels.MAX_MS, Rappels.durationMs(600))
    }
}
